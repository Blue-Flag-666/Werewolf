import { useState } from 'react';
import { ROLES, type Role, type Rules, defaultRules } from './core/model';
const presets: Record<string, Role[]> = {
  '8 人基础': ['wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager'],
  '12 人预女猎白': [
    'wolf',
    'wolf',
    'wolf',
    'wolf',
    'seer',
    'witch',
    'hunter',
    'idiot',
    'villager',
    'villager',
    'villager',
    'villager',
  ],
  '12 人白狼王骑士': [
    'wolf',
    'wolf',
    'wolf',
    'whiteWolf',
    'seer',
    'witch',
    'guard',
    'knight',
    'villager',
    'villager',
    'villager',
    'villager',
  ],
};
export function Setup({
  onStart,
  label = '开始单机发牌',
}: {
  onStart: (roles: Role[], rules: Rules) => void;
  label?: string;
}) {
  const [roles, setRoles] = useState<Role[]>(presets['8 人基础']),
    [rules, setRules] = useState<Rules>(structuredClone(defaultRules)),
    [customName, setCustomName] = useState('我的版型');
  const [saved, setSaved] = useState<Record<string, { roles: Role[]; rules: Rules }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('templates') || '{}');
    } catch {
      return {};
    }
  });
  const adjust = (role: Role, delta: number) =>
    setRoles((old) =>
      delta > 0 && old.length < 24
        ? [...old, role]
        : delta < 0
          ? old.filter((r, i) => i !== old.indexOf(role))
          : old,
    );
  const boolLabels: Partial<Record<keyof Rules, string>> = {
    sheriff: '启用警长',
    witchFirstSelf: '女巫首夜可自救',
    witchOtherSelf: '女巫其他夜可自救',
    doubleMedicine: '允许同夜双药',
    seeVictimWithoutSave: '解药用尽仍可看刀口',
    guardSelf: '守卫可自守',
    guardRepeat: '守卫可连续守同一人',
    saveAndGuardKills: '同守同救导致死亡',
    emptyKnife: '允许空刀',
    poisonedHunterShoots: '猎人中毒可开枪',
    poisonedWolfKingShoots: '狼王中毒可带人',
    wolfKingExplosionShoots: '狼王自爆可带人',
    knightRepeat: '骑士可重复决斗',
    explosionEndsElection: '自爆终止本次警长竞选',
    replayOpen: '结束后成员可看全知复盘',
  };
  return (
    <section className="panel setup">
      <div className="section-heading">
        <div>
          <span className="eyebrow">TABLE SETUP</span>
          <h2>配置这一局</h2>
        </div>
        <span className="pill">{roles.length} 人</span>
      </div>
      <details>
        <summary>常用版型与已保存版型</summary>
        <div className="actions">
          {Object.entries(presets).map(([name, deck]) => (
            <button key={name} onClick={() => setRoles(deck)}>
              {name}
            </button>
          ))}
          {Object.entries(saved).map(([name, v]) => (
            <button
              key={name}
              onClick={() => {
                setRoles(v.roles);
                setRules(v.rules);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </details>
      <div className="role-grid">
        {Object.entries(ROLES).map(([id, name]) => (
          <div className="role-count" key={id}>
            <span>{name}</span>
            <button aria-label={`减少${name}`} onClick={() => adjust(id as Role, -1)}>
              −
            </button>
            <strong>{roles.filter((r) => r === id).length}</strong>
            <button aria-label={`增加${name}`} onClick={() => adjust(id as Role, 1)}>
              +
            </button>
          </div>
        ))}
      </div>
      <p className="muted">
        狼人 {roles.filter((r) => ['wolf', 'wolfKing', 'whiteWolf'].includes(r)).length} · 好人{' '}
        {roles.filter((r) => !['wolf', 'wolfKing', 'whiteWolf'].includes(r)).length} · 4–24
        人。可使用无神职或无平民版型。
      </p>
      <details>
        <summary>规则与计时</summary>
        <label>
          胜利规则
          <select
            value={rules.win}
            onChange={(e) => setRules({ ...rules, win: e.target.value as Rules['win'] })}
          >
            <option value="edge">屠边（仅开局非空分组）</option>
            <option value="city">屠城（指定阵营）</option>
          </select>
        </label>
        <label>
          屠城目标阵营（逗号分隔）
          <input
            value={rules.cityTargets.join(',')}
            onChange={(e) =>
              setRules({ ...rules, cityTargets: e.target.value.split(',').map((s) => s.trim()) })
            }
          />
        </label>
        <div className="checks">
          {Object.entries(boolLabels).map(([key, name]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={!!rules[key as keyof Rules]}
                onChange={(e) => setRules({ ...rules, [key]: e.target.checked })}
              />
              {name}
            </label>
          ))}
        </div>
        <div className="fields">
          {(
            [
              ['speechSeconds', '发言秒数（0 关闭）'],
              ['actionSeconds', '普通操作秒数（0 关闭）'],
              ['targetSeconds', '中断技能目标秒数'],
              ['sheriffWeight', '警长放逐票权重'],
            ] as const
          ).map(([key, name]) => (
            <label key={key}>
              {name}
              <input
                type="number"
                min={0}
                max={3600}
                value={rules[key]}
                onChange={(e) => setRules({ ...rules, [key]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
        <label>
          第三方阵营（每行：标识,名称,soleSurvivors 或 parity,优先级,是否共同获胜）
          <textarea
            placeholder="cult,教团,soleSurvivors,10,false"
            onBlur={(e) => {
              try {
                const factions = e.target.value.trim()
                  ? e.target.value
                      .trim()
                      .split('\n')
                      .map((line) => {
                        const [id, label, condition, priority, shared] = line.split(',');
                        if (
                          !id ||
                          ['good', 'wolves'].includes(id) ||
                          !['soleSurvivors', 'parity'].includes(condition)
                        )
                          throw Error();
                        return {
                          id,
                          label,
                          condition: condition as 'soleSurvivors',
                          priority: Number(priority) || 0,
                          shared: shared === 'true',
                        };
                      })
                  : [];
                setRules({ ...rules, thirdParties: factions });
                e.target.setCustomValidity('');
              } catch {
                e.target.setCustomValidity('请按示例填写独立第三方阵营');
                e.target.reportValidity();
              }
            }}
          />
        </label>
        <p className="muted">
          骑士发动即消耗次数，未选目标无效果并恢复流程。首夜未公布死者仍可发动白狼王或骑士公开技能，实际死亡者不能造成技能伤害。
        </p>
      </details>
      <div className="actions">
        <input
          aria-label="自定义版型名称"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
        />
        <button
          onClick={() => {
            const next = { ...saved, [customName]: { roles, rules } };
            setSaved(next);
            localStorage.setItem('templates', JSON.stringify(next));
          }}
        >
          保存版型
        </button>
        <button className="primary" onClick={() => onStart(roles, rules)}>
          {label}
        </button>
      </div>
    </section>
  );
}
