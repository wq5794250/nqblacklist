import { Context, Schema } from 'koishi';
import { HTTP } from '@koishijs/plugin-http';
import cron from 'koishi-plugin-cron';
import parse from 'cron-parser';

export const name = 'nqblacklist';

// 广播需要数据库依赖
export const inject = {
  required: ['cron', 'http']
};

export const usage = `<h1>云黑黑名单查询与推送插件</h1>
<p>此插件用于查询 QQ 号是否在云端黑名单中，并提供定时推送功能。</p>

<h2>定时推送配置示例:</h2>
<p>每隔一天晚上8点发送一次:</p>
<pre>
分 时 日 周
0 20 */1 * 
</pre>
<p>每天早晨7点30分发送一次:</p>
<pre>
分 时 日 周
30 7 * *
</pre>
<p>每周六12点发送一次:</p>
<pre>
分 时 日 周
0 12 * 6
</pre>
<p>高级定时功能可参考 <a href="http://crontab.org/">cron 表达式</a>。不要设置不存在的时间哦。</p>
`;

export interface Config {
  apiEndpoint?: string;
  enablePush?: boolean;
  min?: number;
  hour?: number;
  dayOfMonth?: number;
  weekDay?: number;
  advancedTimer?: boolean;
  cronTime?: string;
  broad?: boolean;
  broadArray?: Array<{
    adapter: string;
    botId: string;
    groupId: string;
    onebotApiBase?: string; // 确保 onebotApiBase 是可选的
  }>;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    apiEndpoint: Schema.string().default('https://yunhei.nqfactory.club/query.php').description('API 端点'),
    enablePush: Schema.boolean().default(false).description('是否启用主动推送'),
    min: Schema.number().default(0).max(59).min(-1).description('每小时的第几分钟(0-59)'),
    hour: Schema.number().default(20).max(23).min(-1).description('每天的第几小时(0-23)'),
    dayOfMonth: Schema.number().default(-1).max(31).min(-1).description('每个月的第几天(0-31)'),
    weekDay: Schema.number().default(-1).max(7).min(-1).description('周几(1-7)'),
    advancedTimer: Schema.boolean().default(false).description('该选项启用后上述基础定时设置将无效'),
    broad: Schema.boolean().default(true).description('在所有群聊广播,关闭后可指定群配置')
  }).description('基础设置'),
  Schema.union([
    Schema.object({
      advancedTimer: Schema.const(true).required(),
      cronTime: Schema.string().description("cron").default('0 20 * * *')
    }),
    Schema.object({})
  ]),
  Schema.union([
    Schema.object({
      broad: Schema.const(false).required(),
      broadArray: Schema.array(Schema.object({
        adapter: Schema.string().default("onebot").description("适配器名"),
        botId: Schema.string().default("552487878").description("机器人账号"),
        groupId: Schema.string().default("1145141919").description("群组号"),
        onebotApiBase: Schema.union([Schema.string(), undefined]).description("OneBot API 端点")
      })).role('table')
    }),
    Schema.object({})
  ])
]);

// 验证 cron 表达式
function validateCronExpression(expression: string): boolean {
  try {
    parse.parseExpression(expression);
    return true;
  } catch (error) {
    console.error('无效的 cron 表达式:', error);
    return false;
  }
}

function formatValue(value: number): string {
  if (value === -1) return '*';
  return value.toString();
}

async function getGroupList(ctx: Context, botId: string, onebotApiBase: string): Promise<string[]> {
  try {
    const response = await ctx.http.post(`${onebotApiBase}/get_group_list`, {}, {
      headers: {
        'X-Self-ID': botId,
      },
    });

    if (!response || !response.data || !Array.isArray(response.data)) {
      console.warn(`无法获取机器人 ${botId} 的群组列表`);
      return [];
    }

    return response.data.map(group => group.group_id.toString());
  } catch (error) {
    console.error(`获取机器人 ${botId} 的群组列表时发生错误:`, error);
    return [];
  }
}

async function getGroupMembers(ctx: Context, botId: string, groupId: string, onebotApiBase: string): Promise<Record<string, any>> {
  try {
    const response = await ctx.http.post(`${onebotApiBase}/get_group_member_list`, {
      group_id: groupId,
    }, {
      headers: {
        'X-Self-ID': botId,
      },
    });

    if (!response || !response.data || !Array.isArray(response.data)) {
      console.warn(`无法获取群组 ${groupId} 的成员信息`);
      return {};
    }

    return response.data.reduce((acc, member) => {
      acc[member.user_id.toString()] = member;
      return acc;
    }, {} as Record<string, any>);
  } catch (error) {
    console.error(`获取群组 ${groupId} 的成员信息时发生错误:`, error);
    return {};
  }
}

export function apply(ctx: Context, options: Config) {
  // 使用选项中的 apiEndpoint, enablePush 和 pushTime
  const { apiEndpoint, enablePush, min, hour, dayOfMonth, weekDay, advancedTimer, cronTime, broad, broadArray } = options;

  // 检查并验证 pushTime
  let morntime = '';
  if (advancedTimer) {
    if (!validateCronExpression(cronTime)) {
      throw new Error(`无效的 cron 表达式: ${cronTime}`);
    }
    morntime = cronTime;
  } else {
    morntime = `${formatValue(min)} ${formatValue(hour)} ${formatValue(dayOfMonth)} * ${formatValue(weekDay)}`;
  }

  // 添加查云黑命令
  ctx.command('查云黑 <qq>', '查询QQ是否在云黑黑名单中')
    .action(async ({ session }, qq: string) => {
      try {
        const response = await ctx.http.get(`${apiEndpoint}?qq=${qq}`);
        const body = response.toString();

        if (body.includes('黑名单级别')) {
          const levelMatch = body.match(/黑名单级别：(\d+)级/);
          const dateMatch = body.match(/黑名单时间：([\d\- :]+)/);
          const noteMatch = body.match(/黑名单原因：([^<]+)/);

          const level = levelMatch ? levelMatch[1] : '未知';
          const date = dateMatch ? dateMatch[1] : '未知';
          const note = noteMatch ? noteMatch[1].trim() : '未知';

          return `查询结果:\nQQ: ${qq}\n黑名单级别: ${level}级\n黑名单时间: ${date}\n黑名单原因: ${note}`;
        } else {
          return `该QQ未在云端黑名单中。\n但是我们不能保证交易绝对安全。`;
        }
      } catch (error) {
        console.error('请求错误:', error);
        return '查询失败，请稍后重试。';
      }
    });

  // 如果启用了主动推送，则创建定时任务
  if (enablePush) {
    ctx.cron(morntime, async () => {
      let groupsToBroadcast: string[] = [];

      if (broad) {
        // 获取所有连接的机器人及其群组
        for (const bot of Object.values(ctx.bots)) {
          const botId = bot.selfId;
          const onebotApiBase = bot.config.apiRoot; // 假设 bot.config 中有 apiRoot 字段
          if (!onebotApiBase) {
            console.warn(`机器人 ${botId} 没有配置 OneBot API 端点`);
            continue;
          }

          const groupList = await getGroupList(ctx, botId, onebotApiBase);
          groupsToBroadcast.push(...groupList);
        }
      } else {
        groupsToBroadcast = broadArray?.map(item => item.groupId) ?? [];
      }

      for (const groupId of groupsToBroadcast) {
        try {
          // 获取群组对应的机器人 ID 和 OneBot API 端点
          const botInfo = broad
            ? {
                botId: Object.values(ctx.bots)[0]?.selfId,
                onebotApiBase: Object.values(ctx.bots)[0]?.config.apiRoot,
              }
            : broadArray?.find(item => item.groupId === groupId);

          if (!botInfo || !botInfo.botId || ('onebotApiBase' in botInfo && !botInfo.onebotApiBase)) {
            console.warn(`无法找到群组 ${groupId} 对应的机器人或 OneBot API 端点`);
            continue;
          }

          const members = await getGroupMembers(ctx, botInfo.botId, groupId, botInfo.onebotApiBase);

          let blacklistedMembers = [];
          for (const [userId, member] of Object.entries(members)) {
            try {
              const response = await ctx.http.get(`${apiEndpoint}?qq=${userId}`);
              const body = response.toString();

              if (body.includes('黑名单级别')) {
                blacklistedMembers.push(member);
              }
            } catch (error) {
              console.error(`查询${userId}时发生错误:`, error);
            }
          }

          if (blacklistedMembers.length > 0) {
            const message = blacklistedMembers.map((member, index) => `${index + 1}. @${member.card || member.nickname} (${member.user_id})`).join('\n');
            await ctx.http.post(`${botInfo.onebotApiBase}/send_group_msg`, {
              group_id: groupId,
              message: `当前发现本群内存在以下失信人员\n${message}\n可通过指令/查云黑 QQ号 进行详细查询!`
            });
          } else {
            await ctx.http.post(`${botInfo.onebotApiBase}/send_group_msg`, {
              group_id: groupId,
              message: '哇塞，你群所有人都不在云黑里耶'
            });
          }
        } catch (error) {
          console.error(`处理群组 ${groupId} 时发生错误:`, error);
        }
      }
    });
  }
}