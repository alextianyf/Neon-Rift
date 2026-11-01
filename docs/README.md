# 霓虹裂隙 · 设计文档

游戏里所有机体、技能、武装、模块、敌人的属性和特性，以及平衡规则和后续计划。

- 对应版本：**v0.7.0 之后**（含平衡改动，见 [平衡.md](平衡.md)）
- 数值来源：`src/data/` 下的代码文件。改了代码里的数值，记得同步更新对应的文档。

| 文档 | 内容 | 对应代码 |
|---|---|---|
| [全局数值.md](全局数值.md) | 冲刺、暴击、属性上限、敌人成长、无尽模式、裂隙深度 | `balance.ts`、`scaling.ts`、`depth.ts` |
| [机体与天赋.md](机体与天赋.md) | 三台机体、机体技能、天赋、结晶结算、黑市里的机库终端 | `meta.ts`、`menus.ts` |
| [武装.md](武装.md) | 15 把武装的数值、特性、Lv3 / Lv5 强化、实测输出、视觉和声音 | `weapons.ts`、`arsenal.ts` |
| [模块与元素.md](模块与元素.md) | 34 个模块、元素与协同 | `upgrades.ts` |
| [敌人.md](敌人.md) | 主线敌人、精英词缀、扇区主题和敌人池、全部 11 个首领和时间表、双生裂隙、首领伤害保护 | `enemies.ts`、`enemyAI.ts`、`enemyParts.ts`、`affixes.ts`、`themes.ts`、`bossPlan.ts`、`bosses.ts` |
| [无尽与深渊.md](无尽与深渊.md) | 第 16 扇区以后：9 个裂隙地层和 18 种敌人、5 个无尽首领、深渊变种和异变、首领异变形态，第 150 扇区以后的深渊法则、融合体、融合首领和纪元 | `strata.ts`、`partsEndless.ts`、`bossesEndless.ts`、`variants.ts`、`abyss.ts`、`bossForms.ts`、`fusion.ts`、`epoch.ts` |
| [掉落与经济.md](掉落与经济.md) | 武装掉落、击杀掉落、回复球、黑市、宝库 | `balance.ts`、`interactables.ts` |
| [平衡.md](平衡.md) | 后期一枪秒首领的问题、原因、已实现的改动和模拟结果 | — |
