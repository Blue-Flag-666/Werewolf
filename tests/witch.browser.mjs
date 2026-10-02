import assert from 'node:assert/strict';

async function activeGame(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('werewolf-local-v1', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('data').objectStore('data').get('active');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.transaction.oncomplete = () => db.close();
        };
      }),
  );
}
export async function testWitchMedicine(browser, base) {
  for (const doubleMedicine of [false, true]) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(base + '/');
      await page.getByRole('button', { name: '◈ 单机法官', exact: true }).click();
      if (doubleMedicine) {
        await page.getByText('规则与计时', { exact: true }).click();
        await page.getByRole('checkbox', { name: '允许同夜双药', exact: true }).check();
      }
      await page.getByRole('button', { name: '开始单机发牌', exact: true }).click();
      for (let i = 0; i < 8; i++) {
        await page.getByRole('button', { name: '仅我查看身份', exact: true }).click();
        await page.getByRole('button', { name: '记住身份，隐藏并交给下一位', exact: true }).click();
      }
      await page.getByRole('button', { name: '发牌完成，法官开始首夜', exact: true }).click();
      await page.getByRole('button', { name: '确认开始下一角色', exact: true }).click();
      const initial = await activeGame(page);
      const victim = initial.players.find((p) => p.role === 'villager');
      const poisoned = initial.players.find((p) => p.role === 'hunter');
      const witch = initial.players.find((p) => p.role === 'witch');
      await page
        .getByRole('group', { name: '法官最终目标' })
        .getByRole('button', { name: new RegExp('^' + victim.seat + ' 号') })
        .click();
      await page.getByRole('button', { name: '确认狼人最终操作', exact: true }).click();
      await page.getByRole('button', { name: '确认开始下一角色', exact: true }).click();
      await page.getByRole('heading', { name: '女巫操作', exact: true }).waitFor();
      const save = page.getByRole('checkbox', { name: '使用解药', exact: true });
      const poison = page
        .getByRole('group', { name: '毒药目标' })
        .getByRole('button', { name: new RegExp('^' + poisoned.seat + ' 号') });
      await save.check();
      await poison.click();
      assert.equal(await save.isChecked(), doubleMedicine);
      await save.check();
      assert.equal(await poison.getAttribute('aria-pressed'), doubleMedicine ? 'true' : 'false');
      await poison.click();
      // With double medicine enabled, clicking the selected poison toggles it off.
      if (doubleMedicine) await poison.click();
      await page.getByRole('button', { name: '确认操作', exact: true }).click();
      await page.getByRole('button', { name: '确认开始下一角色', exact: true }).waitFor();
      const resolved = await activeGame(page);
      assert.deepEqual(resolved.players.find((p) => p.id === witch.id).medicine, {
        save: doubleMedicine ? 0 : 1,
        poison: 0,
      });
      assert.deepEqual(resolved.night.saves, doubleMedicine ? [victim.id] : []);
      assert.deepEqual(resolved.night.poisons, [{ source: witch.id, target: poisoned.id }]);
    } finally {
      await context.close();
    }
  }
  console.log(
    'PASS: witch UI enforces single medicine or submits both when enabled, with correct consumption',
  );
}
