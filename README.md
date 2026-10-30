# Neon-Rift

霓虹裂隙：一款网页端俯视角 Roguelite 射击游戏，纯静态，单人游玩。基于 Three.js + TypeScript + Vite。

## 开发

需要 Node.js 18+。

```bash
npm install
npm run dev        # 开发服务器 http://localhost:8173，改代码自动刷新
npm run typecheck  # 只做类型检查
npm run build      # 类型检查 + 打包到 dist/
npm run preview    # 本地预览打包结果
```

`dist/` 是纯静态文件，可以直接部署到 GitHub Pages、Cloudflare Pages 或 itch.io。

开发模式下，浏览器控制台里可以用 `window.game` 访问整个游戏实例（打包后不会暴露），方便调试，例如：

```js
game.player.invuln = 999                                          // 无敌
game.enemies.list.forEach(e => game.enemies.damage(e, 1e9))       // 清场
```

## 操作

| 按键 | 作用 |
| --- | --- |
| WASD / 方向键 | 移动 |
| 鼠标 | 瞄准，左键射击 |
| 空格 / 右键 | 冲刺（带无敌帧） |
| 1 2 3 / Q / 滚轮 | 切换武器（最多 3 把） |
| E | 拾取武器 / 在商店购买 |
| Esc / P | 暂停（查看属性、已获得强化、设置） |

## 玩法

- **扇区节奏**：每 5 个扇区一个裂隙核心（首领，5、10、15…），第 3、8、13… 扇区是黑市终端（商店），其余是战斗扇区。敌人从时空裂缝中出现。
- **武器**：9 把武器，最多带 3 把。前两个房间和首领必掉武器，其余战斗房 30% 几率掉落。拾取已有的武器会升级（每级伤害 +25%），槽位满时会替换当前武器，旧武器掉在地上。
- **元素**：点燃（持续伤害）、冰冻（减速）、闪电（链式跳跃到附近敌人）。部分武器自带元素，强化也能给所有子弹附加元素几率。
- **强化**：分普通 / 稀有 / 传说三档，首领奖励只出稀有和传说。部分强化有叠加上限。
- **数据碎片**：敌人掉落的货币，在黑市终端购买武装、模块和维修包。
- **连杀**：2.5 秒内连续击杀叠加连杀数，提高得分（最多 +100%），受伤会中断。

## 代码结构

```
src/
  main.ts            入口：创建 Game 并启动
  style.css          HUD 和菜单样式
  core/              与玩法无关的底层
    graphics.ts      渲染器、场景、相机跟随、泛光后处理
    input.ts         键盘 / 鼠标输入
    audio.ts         WebAudio 合成音效
    assets.ts        共享几何体和发光材质
    math.ts          rand / clamp 等工具
  data/              纯配置，调数值、加内容主要改这里
    weapons.ts       武器参数
    enemies.ts       敌人参数
    upgrades.ts      强化池
    balance.ts       全局数值（玩家属性、房间难度曲线等）
  game/              玩法系统
    game.ts          总控：状态机、主循环、房间流程
    player.ts        玩家移动、冲刺、射击、瞄准
    mech.ts          玩家机甲模型与动画（双臂炮、腿部、推进器）
    enemies.ts       敌人生成、受伤、死亡、通用移动
    enemyAI.ts       每种敌人的行为逻辑
    enemyModels.ts   敌人"病毒体"外观：核心 + 线框外壳 + 故障动画
    rift.ts          敌人出场的时空裂缝效果
    projectiles.ts   玩家子弹、敌人子弹、爆炸
    room.ts          房间生成、碰撞、刷怪计划、传送门
    atmosphere.ts    场景氛围：裂隙雾气、数据粒子、地面数据流、虚空碎片
    pickups.ts       回血球、金币
    interactables.ts 地上的武器掉落、商店商品（按 E 交互）
    effects.ts       粒子、闪电、屏幕震动、命中卡顿
  ui/
    hud.ts           血条、分数、金币、连杀、武器栏、交互提示、命中标记
    screens.ts       标题 / 强化选择 / 暂停（属性与设置）/ 结算界面
    icons.ts         武装图标（SVG）
    floaters.ts      伤害数字、商品价签等跟随 3D 位置的文字
    settings.ts      音量、屏幕震动、伤害数字开关（localStorage）
    storage.ts       最佳纪录（localStorage）
```

### 常见扩展方式

- **加武器**：在 `data/weapons.ts` 加一项（射速、弹道、穿透、反弹、爆炸、元素等都是配置项），再在 `core/audio.ts` 的 `sfx.shoot` 里加同名音效。
- **加敌人**：在 `data/enemies.ts` 加参数，在 `game/enemyAI.ts` 写行为函数并登记到 `BEHAVIORS`，再在 `game/room.ts` 的 `plan()` 里决定什么时候刷出来。
- **加强化**：在 `data/upgrades.ts` 加一项并指定稀有度；如需新属性，在 `game/player.ts` 加字段并在 `reset()` 里重置。
