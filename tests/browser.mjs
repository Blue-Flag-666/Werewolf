import { chromium } from 'playwright';
import { testWolfConsensus } from './wolves.browser.mjs';
import { testWitchMedicine } from './witch.browser.mjs';
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
const actionTarget = page
  .getByRole('group', { name: '法官最终目标', exact: true })
  .getByRole('button')
  .first();
const emptyKnife = page
  .getByRole('group', { name: '狼人最终操作', exact: true })
  .getByRole('button', { name: /不选/ });
await emptyKnife.click();
if ((await emptyKnife.getAttribute('aria-pressed')) !== 'true')
  throw Error('Empty knife option did not become selected');
await actionTarget.click();
if ((await actionTarget.getAttribute('aria-pressed')) !== 'true')
  throw Error('Action target did not become selected');
if ((await emptyKnife.getAttribute('aria-pressed')) !== 'false')
  throw Error('Empty knife option did not clear after selecting a target');
await actionTarget.click();
if ((await actionTarget.getAttribute('aria-pressed')) !== 'false')
  throw Error('Action target did not clear on second click');
await actionTarget.click();
const knifeDialog = (dialog) => {
  errors.push('狼人最终操作不应弹出确认框');
  void dialog.dismiss();
};
page.on('dialog', knifeDialog);
await page.getByRole('button', { name: '确认狼人最终操作', exact: true }).click();
await page.getByRole('button', { name: '确认开始下一角色', exact: true }).waitFor();
page.off('dialog', knifeDialog);
await page.getByRole('button', { name: '确认开始下一角色', exact: true }).click();
await page.getByRole('heading', { name: '女巫操作', exact: true }).waitFor();
await page.getByRole('button', { name: '不发动', exact: true }).click();
await page.getByRole('button', { name: '确认开始下一角色', exact: true }).click();
await page.getByRole('heading', { name: '预言家操作', exact: true }).waitFor();
const checkedSeat = await page.evaluate(
  () =>
    new Promise((resolve, reject) => {
      const open = indexedDB.open('werewolf-local-v1', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('data').objectStore('data').get('active');
        request.onsuccess = () =>
          resolve(request.result.players.find((p) => p.faction === 'wolves').seat);
        request.onerror = () => reject(request.error);
        request.transaction.oncomplete = () => db.close();
      };
    }),
);
await page
  .getByRole('group', { name: '行动目标', exact: true })
  .getByRole('button', { name: new RegExp('^' + checkedSeat + ' 号') })
  .click();
await page.getByRole('button', { name: '确认操作', exact: true }).click();
const checkResult = page.getByRole('region', { name: '本次查验结果', exact: true });
await checkResult.getByRole('heading', { name: '狼人', exact: true }).waitFor();
if (await page.getByRole('button', { name: '确认开始下一角色', exact: true }).count())
  throw Error('Seer result screen allowed skipping completion');
await page.getByRole('button', { name: '完成查验', exact: true }).click();
await page.getByRole('button', { name: '结算夜间效果', exact: true }).waitFor();
await page.getByRole('button', { name: '结算夜间效果', exact: true }).click();
await page.getByRole('group', { name: '警长报名名单' }).getByRole('button').first().click();
await page.getByRole('button', { name: '确认报名名单（1 人）', exact: true }).click();
await page.getByRole('button', { name: '结束竞选发言', exact: true }).click();
const electionResult = page.getByRole('region', { name: '警长竞选结果', exact: true });
await electionResult.getByRole('heading', { name: /当选警长/ }).waitFor();
if (await page.getByRole('button', { name: '公布夜间死亡', exact: true }).count())
  throw Error('Sheriff result could be skipped');
await page.getByRole('button', { name: '完成竞选结果展示', exact: true }).click();
await page.getByRole('button', { name: '公布夜间死亡', exact: true }).waitFor();
await page.getByText('法官工具', { exact: true }).click();
await page.getByRole('button', { name: '临时表决', exact: true }).click();
await page.getByRole('button', { name: '发起临时表决', exact: true }).waitFor();
await page.getByRole('button', { name: '胜负裁定', exact: true }).click();
await page.getByRole('button', { name: '确认胜负并结束', exact: true }).waitFor();
await page.getByRole('button', { name: '玩家裁定', exact: true }).click();
await page.getByRole('button', { name: '1 号', exact: true }).click();
await page.getByRole('textbox', { name: '1 号玩家笔记', exact: true }).fill('重点观察');
await page.getByRole('button', { name: '主笔记', exact: true }).click();
await page.getByRole('textbox', { name: '主笔记', exact: true }).fill('首夜记录');
await page.getByRole('button', { name: '1 号', exact: true }).click();
if (
  (await page.getByRole('textbox', { name: '1 号玩家笔记', exact: true }).inputValue()) !==
  '重点观察'
)
  throw Error('Player note did not survive tab switching');
await page.screenshot({ path: 'tests/judge.png', fullPage: true });
await page.reload();
await page.getByRole('button', { name: '◈ 单机法官 · 恢复本局', exact: true }).click();
await page.getByRole('heading', { name: '身份已遮挡', exact: true }).waitFor();
await page.getByRole('button', { name: '我是法官，恢复本局', exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: '深色主题', exact: true }).click();
await page.screenshot({ path: 'tests/mobile-dark.png', fullPage: true });
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth,
);
if (overflow) throw Error('Mobile horizontal overflow');
await page.setViewportSize({ width: 768, height: 1024 });
await page.getByRole('button', { name: '浅色主题', exact: true }).click();
await page.screenshot({ path: 'tests/tablet.png', fullPage: true });
page.once('dialog', (dialog) => dialog.accept());
await page.getByRole('button', { name: '结束本局', exact: true }).click();
await page.getByRole('heading', { name: '本局复盘', exact: true }).waitFor();
await page.getByRole('button', { name: '返回主页', exact: true }).click();
await page.getByRole('heading', { name: '复盘记录', exact: true }).waitFor();
await page.getByRole('button', { name: '◈ 单机法官', exact: true }).waitFor();
await page.getByRole('button', { name: '进入单机模式 →', exact: true }).waitFor();
await page.getByRole('button', { name: '查看复盘', exact: true }).click();
await page.getByRole('heading', { name: '本局复盘', exact: true }).waitFor();
await page.getByRole('button', { name: '再来一局', exact: true }).click();
await page.getByRole('heading', { name: '配置这一局', exact: true }).waitFor();
await page.getByRole('button', { name: '开始单机发牌', exact: true }).click();
await page.getByRole('button', { name: '仅我查看身份', exact: true }).waitFor();
await page.context().setOffline(true);
await page.reload();
await page.getByRole('button', { name: '◈ 单机法官 · 恢复本局', exact: true }).click();
await page.getByRole('heading', { name: '身份已遮挡', exact: true }).waitFor();
if (requests.some((url) => url.includes('/api/'))) throw Error('单机模式调用了多人接口');
await testWolfConsensus(browser, process.env.TEST_URL || 'http://127.0.0.1:8787');
await testWitchMedicine(browser, process.env.TEST_URL || 'http://127.0.0.1:8787');
await browser.close();
if (errors.length) throw Error(errors.join('\n'));
console.log(
  'PASS: browser local deal, night action, end/new game, refresh privacy, responsive layouts, themes, no runtime errors',
);
