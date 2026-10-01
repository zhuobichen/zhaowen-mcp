/**
 * 已知的「巨型图集仓库」——它们的顶层目录本身就是按角色/主题命名的，
 * 所以"搜主题词"除了走 GitHub 仓库搜索，还要在这些仓库里扫目录名。
 *
 * 这份清单是人工维护的起点，不是终点：`search_packs` 同时会跑
 * `gh search repos`，新仓库能被动态发现；发现后可以用 save_pack 登记。
 */
export const MEGA_REPOS: { repo: string; note: string }[] = [
  { repo: "zhaoolee/ChineseBQB", note: "中国表情包大集合，顶层目录按角色命名（如 007Tiger_胖虎🐯BQB）" },
  { repo: "getActivity/EmojiPackage", note: "表情包合集" },
  { repo: "EDMOK/blue-fish-archive", note: "蓝色大肥鱼档案馆（DeepSeek 娘）" },
  { repo: "lmy414/ai-girl-stickers", note: "AI 娘二创表情包开放档案" },
  { repo: "MemeMeow-Studio/MemeMeow", note: "表情包管理工具（图源未必在此）" },
];

/**
 * 搜索关键词的扩展后缀。中文社区里"表情包"和"bqb"都常用，
 * 只搜一种会漏掉一半仓库。
 */
export const QUERY_SUFFIXES = ["表情包", "memes", "sticker", "BQB"];

/** GitHub 搜索里显式排掉的噪声类型。 */
export const QUERY_BLOCKLIST = ["-topic:telegram", "-topic:discord-bot"];
