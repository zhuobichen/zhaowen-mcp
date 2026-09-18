/**
 * 海克斯大乱斗（ARAM Mayhem）数据结构定义
 *
 * 数据来源有两类：
 *   1. 社区站 arammayhem.com 的静态 JSON —— 中文效果说明、英雄胜率、羁绊、英雄×符文搭配
 *   2. Riot 官方游戏文件（CommunityDragon 提供的 lol-game-data 导出）—— 官方中文名、品质、图标、模式归属
 * 两者在 refresh 阶段合并、交叉校验，结果写入 data/ 目录，运行时只读本地文件。
 */

/** 符文品质：银 / 金 / 棱彩（官方数据里另有 kEventChoice 事件品质） */
export type Rarity = "silver" | "gold" | "prismatic" | "event" | "unknown";

/**
 * 是否在当前在池：
 *   live    社区站在池列表里标为 live（当前对局能选到）
 *   retired 社区站标注已移除
 *   unknown 只在官方游戏文件或社区站搜索索引里出现，来源没有标注状态（可能是已轮换下架，也可能是新符文）
 */
export type Availability = "live" | "retired" | "unknown";

/** 强度统计（来自社区站符文强度榜，只有进榜符文才有数据） */
export interface AugmentStats {
  /** 强度榜排名（1 最强，含已下架符文的综合榜） */
  rank: number | null;
  /** 只在当前在池符文里排的榜（社区站数据） */
  liveRank: number | null;
  winRate: string | null;
  pickRate: string | null;
  /** 该符文表现最好的几个英雄（社区站给出的中文常用名） */
  topChampions: string[];
  url: string | null;
}

/** 国服数据（aramgg 聚合的腾讯样本），与社区站的全球口径分开存 */
export interface CnStats {
  winRate: number | null;
  pickRate: number | null;
  /** 1 最强，数值越大越弱（该站自己的档位） */
  tier: number | null;
  useRank: number | null;
  winRank: number | null;
  useRankDelta: number | null;
  winRankDelta: number | null;
  topChampionIds: number[];
  version: string | null;
  date: string | null;
  source: string;
}

export interface Augment {
  /** 主键：社区站 slug（小写英文，如 adamant / aram_adapt） */
  id: string;
  /** 展示用中文名：官方名优先，官方缺失时用社区站名 */
  name: string;
  /** 社区站中文名 */
  nameCommunity: string;
  /** Riot 官方中文名（来自客户端游戏文件，即国服游戏内显示的名字） */
  nameOfficial: string | null;
  nameEn: string | null;
  nameTw: string | null;
  rarity: Rarity;
  /** 官方品质原始值（kSilver/kGold/kPrismatic/kEventChoice），用于交叉校验 */
  officialRarity: string | null;
  /** 展示用效果说明：官方游戏文件文本优先，缺失时用社区站文本 */
  desc: string | null;
  /** 官方游戏文件里的原文（含 @xxx@ 占位符，游戏内会替换成实际数值） */
  descOfficial: string | null;
  /** 社区站整理过的说明（数值已填好，可读性更好） */
  descCommunity: string | null;
  descEn: string | null;
  icon: string | null;
  officialIcon: string | null;
  /** 模式归属（中文，如 ["海克斯大乱斗"] / ["斗魂竞技场"]） */
  modes: string[];
  /** 官方内部轮换池名称（CHERRY / KIWI / KIWI_JADE） */
  officialLists: string[];
  officialNameId: string | null;
  officialId: number | null;
  /** 社区站强度榜（全球口径） */
  stats: AugmentStats | null;
  /** 国服口径数据（腾讯样本，aramgg 聚合） */
  cnStats: CnStats | null;
  /** 是否在当前在池（见 Availability 说明） */
  availability: Availability;
  /** 记录主要来自哪里：community = 社区站有中文说明；official = 只有官方游戏文件的数据 */
  source: "community" | "official";
  /** 官方名与社区站名不一致（此时搜索两者都能命中） */
  nameConflict: boolean;
}

export interface Champion {
  /** 英文 id（如 Brand），也是官方 championId */
  id: string;
  /** 中文常用名（社区站 title.zh-CN，如 亚索 / 布兰德） */
  name: string;
  /** 中文称号（社区站 name.zh-CN，如 疾风剑豪 / 复仇焰魂） */
  epithet: string;
  nameEn: string;
  epithetEn: string;
  /** 社区站的梯队（S+/S/A/B/C）与胜率（全球口径） */
  tier: string | null;
  winRate: string | null;
  /** 国服口径（aramgg 聚合的腾讯样本） */
  cnWinRate: number | null;
  cnPickRate: number | null;
  cnTier: number | null;
  cnRank: number | null;
  icon: string | null;
  /** 手动维护的国服常用外号（data/aliases.json），如 火男 / 剑圣 */
  aliases: string[];
  /**
   * Riot 官方英雄定位标签（champion-summary.json 的 roles）：
   * mage / support / fighter / tank / marksman / assassin，一名英雄可挂多个。
   * 粒度很粗（辅助也会带 mage），所以只用来做「对面大概是什么构成」的粗分类，别当精确克制用。
   */
  roles?: string[];
}

/** 社区站「英雄×符文」单件评价卡片（带 神级/陷阱 等类型标签与中文攻略） */
export interface ComboCard {
  id: number;
  slug: string;
  championId: string;
  championName: string;
  augmentId: string;
  augmentName: string;
  tier: string | null;
  /** 类型标签中文（神级 / 强力 / 陷阱 / 娱乐 / 黑科技 / Bug） */
  types: string[];
  desc: string | null;
  upvoteCount: number;
}

export interface SynergySet {
  id: string;
  slug: string;
  name: string;
  desc: string | null;
  icon: string | null;
  /** 组成该羁绊的符文（社区站给的是英文名，已尽量解析为本地符文 id） */
  augmentIds: string[];
  augmentNames: string[];
  /** 社区站给出但本地符文库中解析不到的英文名（原样保留，便于人工核对） */
  unresolved: string[];
}

export interface Combo {
  slug: string;
  championId: string;
  championName: string;
  tier: string | null;
  /** 中文推荐理由 */
  desc: string | null;
  augmentIds: string[];
  augmentNames: string[];
}

export interface Meta {
  patch: string;
  updatedAt: string;
  sources: Record<string, string>;
  counts: Record<string, number>;
  validation: {
    /** 官方名与社区站名不一致的符文 */
    nameConflicts: string[];
    /** 品质不一致的符文 */
    rarityConflicts: string[];
    /** 只在官方数据里出现（社区站没收录，因此没有中文说明） */
    officialOnly: string[];
    /** 只在社区站出现（官方数据里没匹配到） */
    communityOnly: string[];
    /** 缺中文效果说明的符文 */
    missingDesc: string[];
    /** 缺强度数据的符文 */
    missingStats: string[];
    /** 羁绊里没能解析的符文英文名 */
    unresolvedSynergyAugments: string[];
    /** 手动外号表里指向了不存在英雄的条目 */
    invalidAliases: string[];
    /** 官方文件里同名不同 id 的符文（已按名字去重，保留第一条） */
    duplicateOfficialNames: string[];
    /** 官方符文定义里没取到中文说明的符文 */
    officialDescMissing: string[];
    /** 单件评价卡片里没能在本地符文库解析到的符文 id */
    unresolvedComboCards: string[];
    /** 某个数据源本次没取到（例如官方字符串表拉取失败），为空表示全部正常 */
    dataSourceIssues: string[];
  };
  notes: string[];
}

/** 归档到 data/patch-snapshots/<patch>.json 的版本快照，用于 compare_patches */
export interface PatchSnapshot {
  patch: string;
  updatedAt: string;
  augments: Array<{
    id: string;
    name: string;
    rarity: Rarity;
    availability: Availability;
    descHash: string | null;
    rank: number | null;
    winRate: string | null;
  }>;
  champions: Array<{ id: string; tier: string | null; winRate: string | null }>;
  synergySets: Array<{ id: string; name: string; augmentIds: string[] }>;
}
