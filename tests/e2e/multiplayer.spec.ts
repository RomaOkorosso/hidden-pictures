import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type Browser } from '@playwright/test';

const credentials = new WeakMap<Page, { email: string; password: string }>();

// Dynamic imports run through Vite, under each browser's own authenticated session.
async function sdk(page: Page, method: 'read' | 'write' | 'patch' | 'uid' | 'disconnect' | 'reconnect', path = '', value: unknown = null) {
  return page.evaluate(async ({ method, path, value }) => {
    const modulePath = '/tests/e2e/browser-client.ts';
    const client = await import(/* @vite-ignore */ modulePath);
    return client[method](path, value);
  }, { method, path, value });
}
async function denied(page: Page, method: 'read' | 'write' | 'patch', path: string, value: unknown = null) {
  await expect(sdk(page, method, path, value)).rejects.toThrow(/permission[ _]denied/i);
}
async function register(browser: Browser, n: number) {
  const context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return ['127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  await page.goto('/#/register');
  await page.getByLabel('Имя за столом').fill(`QA Player ${n}`);
  const email = `qa-${Date.now()}-${n}@example.test`;
  const password = `QA-${randomUUID()}`;
  credentials.set(page, { email, password });
  await page.getByLabel('Почта').fill(email);
  await page.getByLabel('Пароль', { exact: false }).fill(password);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Создать комнату', exact: true })).toBeVisible();
  return page;
}
async function closePages(pages: Page[]) {
  for (const [i, p] of pages.entries()) {
    const path = test.info().outputPath(`player-${i}-trace.zip`);
    await p.context().tracing.stop({ path });
    await test.info().attach(`Player ${i} trace`, { path, contentType: 'application/zip' });
    await p.context().close();
  }
}
async function setup(browser: Browser, count = 4) {
  const pages: Page[] = [];
  for (let i = 0; i < count; i++) pages.push(await register(browser, i));
  const host = pages[0]!;
  await host.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  await expect(host.locator('h1.code')).toBeVisible();
  const code = (await host.locator('h1.code').innerText()).trim();
  for (const p of pages.slice(1)) {
    await p.getByLabel('Код', { exact: true }).fill(code);
    await p.getByRole('button', { name: 'Войти по коду', exact: true }).click();
    await expect(p.locator('h1.code')).toHaveText(code);
  }
  for (let i = 0; i < count; i++) {
    const row = host.locator('.teams li').filter({ hasText: `QA Player ${i}` });
    await row.locator('select').nth(0).selectOption(i % 2 === 0 ? 'red' : 'blue');
    if (i < 2) await row.locator('select').nth(1).selectOption('captain');
  }
  const roomId = (await sdk(host, 'read', `roomCodes/${code}`)).roomId as string;
  return { pages, host, roomId };
}
async function deal(pages: Page[], roomId: string) {
  await pages[0]!.getByRole('button', { name: 'Начать партию', exact: true }).click();
  const pending = await sdk(pages[0]!, 'read', `rooms/${roomId}/dealRequests/pending`);
  const dealer = (await sdk(pages[0]!, 'uid')) === pending.initializer ? pages[0]! : pages[1]!;
  await expect((dealer === pages[0] ? pages[1]! : pages[0]!).getByRole('button', { name: 'Раздать ключ', exact: true })).toHaveCount(0);
  await dealer.getByRole('button', { name: 'Раздать ключ', exact: true }).click();
  for (const p of pages) await expect(p.locator('.board .tile')).toHaveCount(20);
  return sdk(pages[0]!, 'read', `rooms/${roomId}/public`);
}
async function clue(pages: Page[], team: string, count = '8') {
  const captain = team === 'red' ? pages[0]! : pages[1]!;
  await captain.getByLabel('Слово', { exact: true }).fill('проверка');
  await captain.getByLabel('Число').selectOption(count);
  await captain.getByRole('button', { name: 'Подсказка', exact: true }).click();
  await expect(captain.locator('.clue-banner')).toContainText('проверка');
}
async function reveal(page: Page, pos: number) {
  await page.getByRole('listitem', { name: `Card ${pos + 1}`, exact: true }).click();
  await page.getByRole('button', { name: 'Открыть', exact: true }).click();
}

test('four-player game: captain privacy, turns, reconnect, agent victory, rematch and assassin', async ({ browser }, info) => {
  const { pages, host, roomId } = await setup(browser);
  try {
    let pub = await deal(pages, roomId);
    const mid = pub.matchId;
    const key = await sdk(host, 'read', `rooms/${roomId}/secret/${mid}`);
    expect(await sdk(pages[1]!, 'read', `rooms/${roomId}/secret/${mid}`)).toEqual(key);
    await host.getByRole('button', { name: 'Посмотреть ключ', exact: true }).click();
    await expect(host.getByRole('gridcell')).toHaveCount(20);
    for (const [pos, role] of Object.entries(key.roles)) await expect(host.getByRole('gridcell').nth(Number(pos))).toHaveClass(new RegExp(`role-${role}`));
    await host.screenshot({ path: info.outputPath('captain-key.png'), fullPage: true });
    await host.getByRole('button', { name: 'Закрыть', exact: true }).click();
    expect(await sdk(host, 'read', `rooms/${roomId}/public`)).toEqual(pub);
    for (const p of pages.slice(2)) {
      await expect(p.getByRole('button', { name: 'Посмотреть ключ', exact: true })).toHaveCount(0);
      await expect(p.locator('.board [class*="key-"]')).toHaveCount(0);
      await denied(p, 'read', `rooms/${roomId}/secret/${mid}`);
      await denied(p, 'read', `rooms/${roomId}`);
    }
    await pages[2]!.screenshot({ path: info.outputPath('guesser-board.png'), fullPage: true });
    // Every action goes through UI; keys are read only from the captain's session.
    const start = pub.currentTeam;
    const own = (team: string) => Object.entries(key.roles).filter(([, role]) => role === team).map(([pos]) => Number(pos));
    const activeCaptain = start === 'red' ? pages[0]! : pages[1]!;
    await activeCaptain.getByRole('listitem', { name: `Card ${own(start)[0]! + 1}`, exact: true }).click();
    await activeCaptain.getByRole('button', { name: 'Верная', exact: true }).click();
    await expect(activeCaptain.locator('.mark-pip')).toHaveCount(1);
    const owner = await sdk(activeCaptain, 'uid');
    const otherCaptain = start === 'red' ? pages[1]! : pages[0]!;
    await denied(otherCaptain, 'read', `rooms/${roomId}/captainNotes/${owner}`);
    await denied(pages[2]!, 'read', `rooms/${roomId}/captainNotes/${owner}`);
    await expect(pages[2]!.locator('.mark-pip')).toHaveCount(0);
    await clue(pages, start);
    const guesser = start === 'red' ? pages[2]! : pages[3]!;
    await reveal(guesser, own(start)[0]!);
    for (const p of pages) await expect(p.locator('.board .veil')).toHaveCount(1);
    await guesser.getByRole('button', { name: 'Конец хода', exact: true }).click();
    const other = start === 'red' ? 'blue' : 'red';
    await clue(pages, other);
    const neutral = Number(Object.entries(key.roles).find(([, role]) => role === 'neutral')![0]);
    await reveal(other === 'red' ? pages[2]! : pages[3]!, neutral);
    for (const p of pages) await expect(p.locator('.board .veil')).toHaveCount(2);
    await guesser.reload();
    await expect(guesser.locator('.board .veil')).toHaveCount(2);
    await clue(pages, start);
    for (const pos of own(start).slice(1)) {
      await reveal(guesser, pos);
      for (const p of pages) await expect(p.getByRole('listitem', { name: `Card ${pos + 1}`, exact: true }).locator('.veil')).toBeVisible();
    }
    for (const p of pages) {
      await expect(p.locator('.banner h1')).toContainText('Победили');
      await expect(p.getByRole('status')).toHaveCount(0);
    }
    await host.screenshot({ path: info.outputPath('agent-victory.png'), fullPage: true });
    await host.getByRole('button', { name: 'Новая партия', exact: true }).click();
    for (const p of pages) await expect(p.locator('.board')).toHaveCount(0);
    await denied(pages[2]!, 'read', `rooms/${roomId}/secret/${mid}`);
    pub = await deal(pages, roomId);
    expect(pub.matchId).not.toBe(mid);
    await denied(host, 'read', `rooms/${roomId}/secret/${mid}`);
    const nextKey = await sdk(host, 'read', `rooms/${roomId}/secret/${pub.matchId}`);
    await clue(pages, pub.currentTeam);
    const assassin = Number(Object.entries(nextKey.roles).find(([, role]) => role === 'assassin')![0]);
    await reveal(pub.currentTeam === 'red' ? pages[2]! : pages[3]!, assassin);
    for (const p of pages) await expect(p.locator('.banner h1')).toContainText('Победили');
    expect((await sdk(host, 'read', `rooms/${roomId}/public`)).winReason).toBe('assassin');
    await expect(pages[2]!.getByRole('status')).toHaveCount(0);
    await pages[2]!.setViewportSize({ width: 390, height: 844 });
    await pages[2]!.evaluate(() => window.scrollTo(0, 0));
    await pages[2]!.screenshot({ path: info.outputPath('mobile-finished.png'), fullPage: true });
  } finally { await closePages(pages); }
});

test('SDK attacks cannot elevate roles, finish a match, hijack host or overwrite public state', async ({ browser }) => {
  const { pages, host, roomId } = await setup(browser);
  try {
    const pub = await deal(pages, roomId);
    const uid = await sdk(pages[2]!, 'uid');
    await denied(pages[2]!, 'patch', `rooms/${roomId}/members/${uid}`, { role: 'captain' });
    await denied(pages[2]!, 'patch', `rooms/${roomId}/meta`, { status: 'finished' });
    await denied(pages[2]!, 'patch', `rooms/${roomId}/meta`, { hostId: uid });
    await denied(pages[2]!, 'patch', `rooms/${roomId}/public`, { winner: 'red' });
    await denied(pages[2]!, 'read', `rooms/${roomId}/secret/${pub.matchId}`);
    expect((await sdk(host, 'read', `rooms/${roomId}/public`)).winner).toBeUndefined();
  } finally { await closePages(pages); }
});

test('six players: simultaneous reveal is applied once and opponent requests are rejected', async ({ browser }) => {
  const { pages, host, roomId } = await setup(browser, 6);
  try {
    const pub = await deal(pages, roomId);
    const key = await sdk(host, 'read', `rooms/${roomId}/secret/${pub.matchId}`);
    await clue(pages, pub.currentTeam);
    const before = await sdk(host, 'read', `rooms/${roomId}/public`);
    const pos = Number(Object.entries(key.roles).find(([, r]) => r === pub.currentTeam)![0]);
    const guessers = pub.currentTeam === 'red' ? [pages[2]!, pages[4]!] : [pages[3]!, pages[5]!];
    for (const p of guessers) await p.getByRole('listitem', { name: `Card ${pos + 1}`, exact: true }).click();
    await Promise.all(guessers.map(p => p.getByRole('button', { name: 'Открыть', exact: true }).click()));
    for (const p of pages) await expect(p.locator('.board .veil')).toHaveCount(1);
    const after = await sdk(host, 'read', `rooms/${roomId}/public`);
    expect(after.version).toBe(before.version + 1);
    expect(after.guessesMade).toBe(1);
    expect(after.remaining[pub.currentTeam]).toBe(before.remaining[pub.currentTeam] - 1);
    const opponent = pub.currentTeam === 'red' ? pages[3]! : pages[2]!;
    await denied(opponent, 'write', `rooms/${roomId}/actions/reveal-malicious`, {
      uid: await sdk(opponent, 'uid'), position: pos + 1, matchId: after.matchId,
      turnId: after.turnId, version: after.version, at: Date.now(),
    });
    await expect.poll(() => sdk(host, 'read', `rooms/${roomId}/actions`)).toBeNull();
  } finally { await closePages(pages); }
});

test('duo training: opposing captain opens the assassin', async ({ browser }) => {
  const { pages, host, roomId } = await setup(browser, 2);
  try {
    const pub = await deal(pages, roomId);
    const key = await sdk(host, 'read', `rooms/${roomId}/secret/${pub.matchId}`);
    await clue(pages, pub.currentTeam, '1');
    const opener = pub.currentTeam === 'red' ? pages[1]! : pages[0]!;
    const own = Number(Object.entries(key.roles).find(([, r]) => r === pub.currentTeam)![0]);
    await reveal(opener, own);
    for (const p of pages) await expect(p.locator('.board .veil')).toHaveCount(1);
    await opener.getByRole('button', { name: 'Конец хода', exact: true }).click();
    const other = pub.currentTeam === 'red' ? 'blue' : 'red';
    await clue(pages, other, '1');
    const pos = Number(Object.entries(key.roles).find(([, r]) => r === 'assassin')![0]);
    await reveal(other === 'red' ? pages[1]! : pages[0]!, pos);
    for (const p of pages) await expect(p.locator('.banner h1')).toContainText('Победили');
  } finally { await closePages(pages); }
});

test('registration, profile, sign-out/sign-in and last-player room cleanup', async ({ browser }) => {
  const page = await register(browser, 10);
  try {
    await page.getByRole('link', { name: 'Профиль', exact: true }).click();
    await page.getByLabel('Имя за столом').fill('QA Renamed');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const uid = await sdk(page, 'uid');
    expect((await sdk(page, 'read', `profiles/${uid}`)).displayName).toBe('QA Renamed');
    const email = await page.evaluate(async () => {
      const path = '/src/firebase/app.ts';
      return (await import(/* @vite-ignore */ path)).requireFirebase().auth.currentUser.email;
    });
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Войти', exact: true })).toBeVisible();
    await page.getByLabel('Почта').fill(email);
    await page.getByLabel('Пароль').fill(credentials.get(page)!.password);
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible();
    await page.locator('.brand').click();
    await page.getByRole('button', { name: 'Создать комнату', exact: true }).click();
    await expect(page.locator('h1.code')).toBeVisible();
    const code = (await page.locator('h1.code').innerText()).trim();
    await page.locator('section').filter({ has: page.locator('h1.code') }).getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Создать комнату', exact: true })).toBeVisible();
    expect(await sdk(page, 'read', `roomCodes/${code}`)).toBeNull();
  } finally { await closePages([page]); }
});


test('repeated disconnect/reconnect restores presence and gameplay', async ({ browser }) => {
  const { pages, host, roomId } = await setup(browser);
  try {
    const pub = await deal(pages, roomId);
    const key = await sdk(host, 'read', `rooms/${roomId}/secret/${pub.matchId}`);
    const guest = pub.currentTeam === 'red' ? pages[2]! : pages[3]!;
    const uid = await sdk(guest, 'uid');
    for (let i = 0; i < 2; i++) {
      await sdk(guest, 'disconnect');
      await expect.poll(async () => (await sdk(host, 'read', `rooms/${roomId}/presence/${uid}`)).online).toBe(false);
      await sdk(guest, 'reconnect');
      await expect.poll(async () => (await sdk(host, 'read', `rooms/${roomId}/presence/${uid}`)).online).toBe(true);
    }
    await clue(pages, pub.currentTeam);
    const own = Number(Object.entries(key.roles).find(([, r]) => r === pub.currentTeam)![0]);
    await reveal(guest, own);
    for (const p of pages) await expect(p.locator('.board .veil')).toHaveCount(1);
  } finally { await closePages(pages); }
});

test('lobby: a field player replaces their captain and the leaving host transfers ownership', async ({ browser }) => {
  const { pages, host, roomId } = await setup(browser);
  try {
    await pages[2]!.getByRole('button', { name: 'Стать капитаном', exact: true }).click();
    const uid = await sdk(pages[2]!, 'uid');
    const oldHost = await sdk(host, 'uid');
    await expect.poll(async () => (await sdk(host, 'read', `rooms/${roomId}/members/${uid}`)).role).toBe('captain');
    expect((await sdk(host, 'read', `rooms/${roomId}/members/${oldHost}`)).role).toBe('guesser');
    await host.locator('section').filter({ has: host.locator('h1.code') }).getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Создать комнату', exact: true })).toBeVisible();
    const nextHost = await sdk(pages[1]!, 'uid');
    await expect.poll(async () => (await sdk(pages[1]!, 'read', `rooms/${roomId}/meta`)).hostId).toBe(nextHost);
    expect(await sdk(pages[1]!, 'read', `rooms/${roomId}/members/${oldHost}`)).toBeNull();
    await pages[1]!.getByRole('button', { name: 'Случайные команды', exact: true }).click();
    await expect.poll(async () => Object.values(await sdk(pages[1]!, 'read', `rooms/${roomId}/members`)).filter(m => (m as { role: string }).role === 'captain').length).toBe(0);
    await pages[1]!.getByRole('button', { name: 'Случайные капитаны', exact: true }).click();
    await expect.poll(async () => Object.values(await sdk(pages[1]!, 'read', `rooms/${roomId}/members`)).filter(m => (m as { role: string }).role === 'captain').length).toBe(2);
    await expect(pages[1]!.getByRole('button', { name: 'Начать партию', exact: true })).toBeEnabled();
  } finally { await closePages(pages); }
});

test('late outsider and anonymous client cannot join or read a running game', async ({ browser }) => {
  const { pages, host, roomId } = await setup(browser);
  const outsider = await register(browser, 99);
  pages.push(outsider);
  const anonContext = await browser.newContext();
  await anonContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const anon = await anonContext.newPage();
  try {
    const pub = await deal(pages.slice(0, 4), roomId);
    const meta = await sdk(host, 'read', `rooms/${roomId}/meta`);
    for (const suffix of ['meta', 'members', 'public', `secret/${pub.matchId}`]) {
      await denied(outsider, 'read', `rooms/${roomId}/${suffix}`);
    }
    await outsider.getByLabel('Код', { exact: true }).fill(meta.code);
    await outsider.getByRole('button', { name: 'Войти по коду', exact: true }).click();
    await expect(outsider.getByText('Партия уже идёт.', { exact: true })).toBeVisible();
    await anon.goto('/');
    await expect(anon.getByRole('link', { name: 'Регистрация', exact: true })).toBeVisible();
    await denied(anon, 'read', `rooms/${roomId}/secret/${pub.matchId}`);
    await denied(anon, 'read', `roomCodes/${meta.code}`);
    expect(Object.keys(await sdk(host, 'read', `rooms/${roomId}/members`))).toHaveLength(4);
  } finally { await closePages([...pages, anon]); }
});

test('concurrent lobby joins never exceed the twelve-player UI capacity', async ({ browser }) => {
  test.setTimeout(120_000);
  const pages: Page[] = [];
  try {
    for (let i = 0; i < 13; i++) pages.push(await register(browser, i));
    const host = pages[0]!;
    await host.getByRole('button', { name: 'Создать комнату', exact: true }).click();
    await expect(host.locator('h1.code')).toBeVisible();
    const code = (await host.locator('h1.code').innerText()).trim();
    await Promise.all(pages.slice(1).map(async p => {
      await p.getByLabel('Код', { exact: true }).fill(code);
      await p.getByRole('button', { name: 'Войти по коду', exact: true }).click();
      await expect(p.locator('h1.code').or(p.getByText('Комната заполнена.', { exact: true }))).toBeVisible();
    }));
    const roomId = (await sdk(host, 'read', `roomCodes/${code}`)).roomId;
    expect(Object.keys(await sdk(host, 'read', `rooms/${roomId}/members`))).toHaveLength(12);
    let rejected = 0;
    for (const p of pages.slice(1)) if (await p.getByText('Комната заполнена.', { exact: true }).isVisible()) rejected++;
    expect(rejected).toBe(1);
  } finally { await closePages(pages); }
});
