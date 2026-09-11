import { type Rules, type Role, ROLES, defaultRules } from './model';
import { assert } from './rules';
export function validateSetup(roles: unknown, rules: unknown): { roles: Role[]; rules: Rules } {
  assert(
    Array.isArray(roles) &&
      roles.length >= 4 &&
      roles.length <= 24 &&
      roles.every((r) => typeof r === 'string' && Object.hasOwn(ROLES, r)),
    '版型需要 4–24 个已支持的角色',
  );
  assert(rules && typeof rules === 'object' && !Array.isArray(rules), '规则格式无效');
  const input = rules as Record<string, unknown>,
    result = structuredClone(defaultRules);
  for (const key of Object.keys(defaultRules) as (keyof Rules)[]) {
    if (!(key in input)) continue;
    const value = input[key];
    if (typeof defaultRules[key] === 'boolean') {
      assert(typeof value === 'boolean', '规则开关无效');
      Object.assign(result, { [key]: value });
    }
  }
  if ('win' in input) {
    assert(input.win === 'edge' || input.win === 'city', '胜利规则无效');
    result.win = input.win;
  }
  for (const key of ['speechSeconds', 'actionSeconds', 'targetSeconds', 'sheriffWeight'] as const) {
    if (!(key in input)) continue;
    const v = input[key];
    assert(
      typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 3600,
      '计时或票权配置无效',
    );
    result[key] = v;
  }
  assert(result.targetSeconds >= 5 && result.targetSeconds <= 300, '中断目标时间须为 5–300 秒');
  assert(result.sheriffWeight >= 1 && result.sheriffWeight <= 3, '警长票权须为 1–3');
  if ('thirdParties' in input) {
    assert(
      Array.isArray(input.thirdParties) && input.thirdParties.length <= 8,
      '最多 8 个第三方阵营',
    );
    result.thirdParties = input.thirdParties.map((f) => {
      assert(f && typeof f === 'object', '第三方阵营无效');
      assert(
        typeof f.id === 'string' &&
          /^[a-z][a-z0-9_-]{0,23}$/.test(f.id) &&
          !['good', 'wolves'].includes(f.id),
        '第三方阵营标识无效',
      );
      assert(typeof f.label === 'string' && f.label.length <= 24, '阵营名称过长');
      assert(
        ['soleSurvivors', 'parity'].includes(f.condition) &&
          typeof f.shared === 'boolean' &&
          Number.isFinite(f.priority) &&
          Math.abs(f.priority) <= 100,
        '第三方胜利条件无效',
      );
      return {
        id: f.id,
        label: f.label,
        condition: f.condition,
        shared: f.shared,
        priority: f.priority,
      };
    });
    assert(
      new Set(result.thirdParties.map((f) => f.id)).size === result.thirdParties.length,
      '阵营标识不能重复',
    );
  }
  if ('cityTargets' in input) {
    assert(
      Array.isArray(input.cityTargets) &&
        input.cityTargets.length > 0 &&
        input.cityTargets.length <= 9 &&
        input.cityTargets.every((x) => x === 'good' || result.thirdParties.some((f) => f.id === x)),
      '屠城目标阵营无效',
    );
    result.cityTargets = input.cityTargets;
  }
  return { roles: [...roles], rules: result };
}
