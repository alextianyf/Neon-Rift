import type { EnemyKind } from './enemies';
import { t } from '../core/i18n';

// Field notes shown in the codex once an enemy has been encountered.
export const ENEMY_NOTES: Record<EnemyKind, string> = {
  grunt: t('最基础的病毒体，直线冲向目标。'),
  swarmer: t('成群出现，单个很脆，但会把你团团围住。'),
  bomber: t('靠近后自爆，爆炸也会炸伤其他病毒体。'),
  splitter: t('被击毁后分裂成一群蜂群体。'),
  shooter: t('保持距离射击，会绕着你走位。'),
  sniper: t('用红色激光瞄准，锁定后发射高速子弹。'),
  shield: t('正面护盾挡下子弹，绕到背后或用爆炸、磁轨炮。'),
  summoner: t('远远地撕开裂缝，不断放出蜂群体。'),
  brute: t('血厚体大，蓄力后高速冲撞。'),
  boss: t('第一个裂隙核心：弹幕、冲撞和召唤。'),
  boss2: t('旋转激光、布雷，召唤自爆虫。'),
  boss3: t('最终首领：穿越裂隙瞬移、螺旋弹幕、召唤精英护卫。'),
};

export const HISTORY_LIMIT = 20;
