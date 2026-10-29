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
| 1 2 3 / Q / 滚轮 | 切换武器 |
| Esc / P | 暂停 |

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
    player.ts        玩家移动、冲刺、射击
    enemies.ts       敌人生成、受伤、死亡、通用移动
    enemyAI.ts       每种敌人的行为逻辑
    projectiles.ts   玩家子弹、敌人子弹、爆炸
    room.ts          房间生成、碰撞、刷怪计划、传送门
    pickups.ts       回血球
    effects.ts       粒子、屏幕震动、命中卡顿
  ui/
    hud.ts           血条、分数、武器栏、提示文字
    screens.ts       标题 / 强化选择 / 暂停 / 结算界面
    storage.ts       最佳纪录（localStorage）
```

### 常见扩展方式

- **加武器**：在 `data/weapons.ts` 加一项；如需新音效，在 `core/audio.ts` 的 `sfx.shoot` 里加同名条目。
- **加敌人**：在 `data/enemies.ts` 加参数，在 `game/enemyAI.ts` 写行为函数并登记到 `BEHAVIORS`，再在 `game/room.ts` 的 `plan()` 里决定什么时候刷出来。
- **加强化**：在 `data/upgrades.ts` 加一项；如需新属性，在 `game/player.ts` 加字段并在 `reset()` 里重置。
