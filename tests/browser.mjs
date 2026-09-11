import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const requests = [];
page.on('request', (r) => requests.push(r.url()));
await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8787');
await page.screenshot({ path: 'tests/desktop.png', fullPage: true });
await page.getByRole('button', { name: '◈ 单机法官', exact: true }).click();
await page.getByRole('button', { name: '开始单机发牌', exact: true }).click();
for (let i = 0; i < 8; i++) {
  await page.getByRole('button', { name: '仅我查看身份', exact: true }).click();
  await page.getByRole('button', { name: '记住身份，隐藏并交给下一位', exact: true }).click();
}
await page.getByRole('button', { name: '发牌完成，法官开始首夜', exact: true }).click();
await page.getByRole('button', { name: '确认开始下一角色', exact: true }).click();
await page.screenshot({ path: 'tests/judge.png', fullPage: true });
await page.reload();
await page.getByRole('button', { name: '◈ 单机法官 · 恢复本局', exact: true }).click();
await page.getByRole('heading', { name: '身份已遮挡', exact: true }).waitFor();
await page.getByRole('button', { name: '我是法官，恢复本局', exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark');
await page.screenshot({ path: 'tests/mobile-dark.png', fullPage: true });
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth,
);
if (overflow) throw Error('Mobile horizontal overflow');
await page.setViewportSize({ width: 768, height: 1024 });
await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('light');
await page.screenshot({ path: 'tests/tablet.png', fullPage: true });
await page.context().setOffline(true);
await page.reload();
await page.getByRole('button', { name: '◈ 单机法官 · 恢复本局', exact: true }).click();
await page.getByRole('heading', { name: '身份已遮挡', exact: true }).waitFor();
if (requests.some((url) => url.includes('/api/'))) throw Error('单机模式调用了多人接口');
await browser.close();
if (errors.length) throw Error(errors.join('\n'));
console.log(
  'PASS: browser local deal, night action, refresh privacy, responsive layouts, themes, no runtime errors',
);
