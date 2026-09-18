#!/usr/bin/env npx tsx
/**
 * aram-mayhem MCP Server —— 英雄联盟「海克斯大乱斗」（ARAM Mayhem）助手
 *
 * 提供符文图鉴/搜索、羁绊（套装）推算、英雄视角推荐、版本对比。
 * 数据：社区站 arammayhem.com 的公开静态数据 + Riot 官方游戏文件（CommunityDragon 导出），
 *       由 lib/refresh.ts 合并成本地快照，运行时只读 data/，不联网（refresh_data 除外）。
 *
 * 启动: npx tsx index.ts
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { refreshData } from "./lib/refresh.js";
import { analyzeMyAugments, myAccountStatus, myRecentGames } from "./lib/my.js";
import { friendStats, listMyFriends } from "./lib/friends.js";
import { tftStats } from "./lib/tft.js";
import { archiveInfo } from "./lib/games.js";
import { analyzeMyPlaystyle } from "./lib/playstyle.js";
import { socialText } from "./lib/social.js";
import { myRanked } from "./lib/ranked.js";
import { scoutTeammates, sendChampSelectMessage } from "./lib/teammates.js";
import { resolveMe } from "./lib/identity.js";
import {
  analyzeSynergy,
  championGuide,
  comparePatches,
  dataInfo,
  getAugmentTool,
  listChampions,
  listSynergySets,
  searchAugmentsTool,
} from "./lib/tools.js";

const SCOPES = ["live", "unknown", "retired", "all"];

async function main() {
  const server = new Server(
    { name: "aram-mayhem", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_data_info",
        description:
          "查看海克斯大乱斗数据概况：当前补丁号、数据更新时间、符文/英雄/羁绊/搭配条数、数据来源与已知的数据出入（官方与社区站不一致的地方）。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "search_augments",
        description:
          "搜索或浏览海斗强化符文（海克斯）。支持中文名、英文名、说明关键词搜索；可按品质（银/金/棱彩）和在池状态过滤；不带 query 就是按强度榜顺序列符文。返回品质、强度榜名次、胜率、选取率。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "关键词：符文名或说明里的字词（如 坦克引擎 / tank engine / 暴击）" },
            rarity: { type: "string", description: "品质过滤：silver(银) / gold(金) / prismatic(棱彩)" },
            mode: { type: "string", description: "模式过滤，如 海克斯大乱斗 / 斗魂竞技场" },
            scope: {
              type: "string",
              enum: SCOPES,
              description: "在池范围：live=当前在池（默认，无 query 时）/ unknown=状态未知 / retired=已下架 / all=全部",
            },
            limit: { type: "number", description: "最多返回多少条（默认 20，上限 100）" },
            sort: { type: "string", enum: ["rank", "name"], description: "排序：rank=强度榜名次（默认）/ name=按名字" },
          },
        },
      },
      {
        name: "get_augment",
        description:
          "查单个符文的详情：官方名/社区站名、品质、在池状态、中文效果说明、强度榜名次与胜率、强势英雄、所属羁绊、被推荐的英雄搭配。",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "符文名（中文或英文，可只写几个字）" },
          },
          required: ["name"],
        },
      },
      {
        name: "list_synergy_sets",
        description: "列出海斗的羁绊（套装）：每套需要哪些符文、凑齐后的效果。可按关键词过滤。",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "可选：按羁绊名/效果/组成符文过滤" },
          },
        },
      },
      {
        name: "analyze_synergy",
        description:
          "羁绊推算：输入你已经拿到或正在考虑的符文，算出能凑出哪些羁绊、各差几件、还缺哪些符文（并标出哪些还当前在池）。",
        inputSchema: {
          type: "object",
          properties: {
            augments: {
              type: "array",
              items: { type: "string" },
              description: "符文名列表，如 [\"坦克引擎\", \"珠光护手\"]",
            },
          },
          required: ["augments"],
        },
      },
      {
        name: "list_champions",
        description: "按胜率或梯队列出海斗强势英雄（社区站统计的梯队与胜率）。",
        inputSchema: {
          type: "object",
          properties: {
            tier: { type: "string", description: "只看某一档：S+ / S / A / B / C" },
            sort: { type: "string", enum: ["winRate", "tier"], description: "排序方式，默认 winRate" },
            limit: { type: "number", description: "最多返回多少个（默认 25）" },
          },
        },
      },
      {
        name: "get_champion_guide",
        description:
          "英雄视角推荐：输入英雄（中文常用名/昵称/称号/英文名），返回梯队与胜率、推荐符文搭配（含社区站推荐理由）、该英雄进入强度榜前列的符文、相关羁绊。",
        inputSchema: {
          type: "object",
          properties: {
            champion: { type: "string", description: "英雄：亚索 / 火男 / 疾风剑豪 / Yasuo 都可以" },
            limit: { type: "number", description: "最多返回多少条搭配（默认 8）" },
          },
          required: ["champion"],
        },
      },
      {
        name: "compare_patches",
        description:
          "对比两个已归档补丁快照的差异：新增/移除的符文、说明改动、品质与名次变动、英雄梯队变动、羁绊增减。默认对比最近两个快照。",
        inputSchema: {
          type: "object",
          properties: {
            base: { type: "string", description: "基准补丁号（默认倒数第二个快照）" },
            target: { type: "string", description: "目标补丁号（默认最新快照）" },
          },
        },
      },
      {
        name: "get_my_account_status",
        description:
          "检查本地游戏客户端（LCU）连接状态，读取本机登录的国服账号并固定下来（写入 data/profile.json）。需要游戏客户端正在运行。",
        inputSchema: {
          type: "object",
          properties: {
            pin: { type: "boolean", description: "是否把当前账号写入 data/profile.json（默认 true）" },
          },
        },
      },
      {
        name: "get_my_recent_games",
        description:
          "读我最近的英雄联盟对局（默认只看海斗）：时间、英雄、胜负、KDA、时长。需要游戏客户端正在运行。",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "看最近多少把（默认 15，上限 50）" },
            only_mayhem: { type: "boolean", description: "只列海斗对局（默认 true；false 则列所有模式）" },
          },
        },
      },
      {
        name: "analyze_my_augments",
        description:
          "统计我最近海斗对局里拿过的符文（次数/胜率），并对照社区站强度榜看拿的符文是不是版本强势。依赖客户端上报符文字段，读不到时会直说。",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "统计最近多少把海斗（默认 20，上限 50）" },
          },
        },
      },
      {
        name: "list_my_friends",
        description:
          "列出本机客户端里当前账号的好友（含在线状态与名字#编号）。只能查好友列表里的人。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_friend_stats",
        description:
          "看某个好友的海斗战绩（读本机客户端缓存的对局）：胜率、常玩英雄、拿过的符文与版本名次、陷阱符文提示、还没拿过的神级符文。传部分名字即可匹配。",
        inputSchema: {
          type: "object",
          properties: {
            friend: { type: "string", description: "好友名字或名字的一部分（如 丁ding / 自己的丁ding#66595）" },
            limit: { type: "number", description: "最多读取多少把对局（默认 200，即客户端缓存的全部）" },
          },
          required: ["friend"],
        },
      },
      {
        name: "get_tft_stats",
        description:
          "查云顶之弈（TFT）战绩：平均名次、吃鸡率、前四率、名次分布、队列分布与最近几局明细。默认查自己，传 friend 可查好友。注意客户端只保留最近 20 局。",
        inputSchema: {
          type: "object",
          properties: {
            friend: { type: "string", description: "可选：好友名字（部分匹配），不传就是查自己" },
            limit: { type: "number", description: "明细列最近多少局（默认 10）" },
          },
        },
      },
      {
        name: "analyze_my_playstyle",
        description:
          "打法画像：时段表现、战斗风格（KDA/伤害/阵亡、胜负局差异）、英雄池集中度、稳定性（连胜连败与近期走势）、以及你选的符文跟版本强势榜的契合度。基于本地归档+客户端数据。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_my_ranked",
        description:
          "查排位段位与战绩（单双排/灵活组排/云顶排位等）：段位、LP、胜负与连胜连败。默认查自己，传 friend 试查好友（客户端可能只给当前登录账号的）。需要客户端在线。",
        inputSchema: {
          type: "object",
          properties: {
            friend: { type: "string", description: "可选：好友名字（部分匹配）" },
          },
        },
      },
      {
        name: "get_my_teammates",
        description:
          "队友/对手分析：谁和你一起打得最多、共同胜率多少、和谁打最稳；以及遇到过哪些对手、你对他们的胜率。数据来自对局里完整的 10 人名单（SGP）。默认查自己，可传 who 查好友。",
        inputSchema: {
          type: "object",
          properties: {
            who: { type: "string", description: "可选：查哪个账号（好友名，部分匹配）。不传就是自己" },
            min_games: { type: "number", description: "只列同队/相遇至少 N 次的（默认 3）" },
          },
        },
      },
      {
        name: "get_champ_select_teammates",
        description:
          "选人阶段侦察队友（只读）：读当前选人会话里的队友，逐个拉他们最近的海斗战绩，整理成一份给你自己看的报告。不会往任何聊天频道发言。",
        inputSchema: {
          type: "object",
          properties: {
            games: { type: "number", description: "每个队友看多少把（默认 100）" },
          },
        },
      },
      {
        name: "send_champ_select_message",
        description:
          "往【当前选人频道】发一条消息（内容必须由用户明确给出；调用时需 confirm=true）。这是用户本人发言的加速器，不是自动发言：一次一条、文本由用户决定。对局内的我方/所有人频道官方没有接口，本工具做不到。",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "要发送的文本（用户指定的原文，不要自行生成评价）" },
            confirm: { type: "boolean", description: "必须为 true 才会真正发送" },
          },
          required: ["text"],
        },
      },
      {
        name: "get_archive_info",
        description:
          "查看本地对局归档的覆盖情况（海斗/英雄联盟 与 云顶各存了多少局、时间跨度、按模式分布）。归档随每次查询自动累积，客户端没开时分析就用它。",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "refresh_data",
        description:
          "联网重新拉取数据并更新本地快照（社区站 + Riot 官方文件），会归档当前补丁快照用于版本对比。仅在需要更新数据时调用。",
        inputSchema: {
          type: "object",
          properties: {
            dry_run: { type: "boolean", description: "true 时只拉取校验、不写文件" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      switch (name) {
        case "get_data_info":
          return text(dataInfo());

        case "search_augments":
          return text(
            searchAugmentsTool({
              query: args.query ? String(args.query) : undefined,
              rarity: args.rarity ? String(args.rarity) : undefined,
              mode: args.mode ? String(args.mode) : undefined,
              scope: args.scope ? (String(args.scope) as "live" | "unknown" | "retired" | "all") : undefined,
              limit: args.limit ? Number(args.limit) : undefined,
              sort: args.sort === "name" ? "name" : args.sort === "rank" ? "rank" : undefined,
            })
          );

        case "get_augment":
          if (!args.name) return text("请提供符文名 name");
          return text(getAugmentTool({ name: String(args.name) }));

        case "list_synergy_sets":
          return text(listSynergySets({ query: args.query ? String(args.query) : undefined }));

        case "analyze_synergy":
          if (!args.augments) return text("请提供符文名列表 augments");
          return text(analyzeSynergy({ augments: args.augments as string[] | string }));

        case "list_champions":
          return text(
            listChampions({
              tier: args.tier ? String(args.tier) : undefined,
              sort: args.sort === "tier" ? "tier" : undefined,
              limit: args.limit ? Number(args.limit) : undefined,
            })
          );

        case "get_champion_guide":
          if (!args.champion) return text("请提供英雄名 champion");
          return text(
            championGuide({
              champion: String(args.champion),
              limit: args.limit ? Number(args.limit) : undefined,
            })
          );

        case "compare_patches":
          return text(
            comparePatches({
              base: args.base ? String(args.base) : undefined,
              target: args.target ? String(args.target) : undefined,
            })
          );

        case "get_my_account_status":
          return text(await myAccountStatus({ pin: args.pin !== false }));

        case "get_my_recent_games":
          return text(
            await myRecentGames({
              limit: args.limit ? Number(args.limit) : undefined,
              only_mayhem: args.only_mayhem !== false,
            })
          );

        case "analyze_my_augments":
          return text(await analyzeMyAugments({ limit: args.limit ? Number(args.limit) : undefined }));

        case "list_my_friends":
          return text(await listMyFriends());

        case "get_friend_stats":
          if (!args.friend) return text("请提供好友名字 friend");
          return text(
            await friendStats({ friend: String(args.friend), limit: args.limit ? Number(args.limit) : undefined })
          );

        case "get_tft_stats":
          return text(
            await tftStats({
              friend: args.friend ? String(args.friend) : undefined,
              limit: args.limit ? Number(args.limit) : undefined,
            })
          );

        case "analyze_my_playstyle":
          return text(await analyzeMyPlaystyle());

        case "get_my_ranked":
          return text(await myRanked({ friend: args.friend ? String(args.friend) : undefined }));

        case "get_my_teammates":
          return text(
            await socialText({
              who: args.who ? String(args.who) : undefined,
              minGames: args.min_games ? Number(args.min_games) : undefined,
            })
          );

        case "get_champ_select_teammates": {
          const me = await resolveMe();
          const r = await scoutTeammates({
            myPuuid: me?.puuid ?? null,
            games: args.games ? Number(args.games) : undefined,
          });
          return text(r.text);
        }

        case "send_champ_select_message":
          return text(
            await sendChampSelectMessage({
              text: String(args.text ?? ""),
              confirm: args.confirm === true,
            })
          );

        case "get_archive_info":
          return text(await archiveInfo());

        case "refresh_data": {
          const r = await refreshData({ dryRun: args.dry_run === true });
          return text(
            [
              `数据已更新（补丁 ${r.patch}，${r.updatedAt}）${args.dry_run === true ? " —— dry_run，未写文件" : ""}`,
              `符文 ${r.counts.augments}（在池 ${r.counts.liveAugments} / 已下架 ${r.counts.retiredAugments} / 未知 ${r.counts.unknownAvailability}）`,
              `英雄 ${r.counts.champions} · 羁绊 ${r.counts.synergySets} · 搭配 ${r.counts.combos}`,
              r.patchChangedFrom ? `⚠ 补丁从 ${r.patchChangedFrom} 变为 ${r.patch}，旧快照已归档，可用 compare_patches 对比` : "",
              `数据出入：名称不一致 ${r.meta.validation.nameConflicts.length} · 品质不一致 ${r.meta.validation.rarityConflicts.length} · 仅官方有 ${r.meta.validation.officialOnly.length}`,
            ]
              .filter(Boolean)
              .join("\n")
          );
        }

        default:
          return text(`未知工具: ${name}`);
      }
    } catch (e: any) {
      return text(`错误: ${e?.message ?? e}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

main().catch(console.error);
