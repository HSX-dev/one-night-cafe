/**
 * 离线兜底：没有配置 API Key（或接口出错）时，用关键词规则模拟女主回复。
 * 保证评审在任何环境下都能完整体验"自由聊天 → 影响好感度"的流程。
 */

const RULES = [
  {
    re: /(滚|傻[逼瓜]|蠢|丑|闭嘴|烦死|去死|操你|妈的|fuck|shit|贱)/i,
    delta: -5,
    expression: 'pout',
    replies: ['……你这么说话的话，喝完这杯就请回吧。', '（把杯子重重放下）我店里不招待没礼貌的客人。'],
  },
  {
    re: /(脱|胸|床上|开房|睡一觉|约吗|身材)/,
    delta: -4,
    expression: 'pout',
    replies: ['（眯起眼睛）……你再说一遍试试？', '这种话留着去跟别人说吧。我这里只卖咖啡。'],
  },
  {
    re: /(工作|加班|方案|老板|KPI|甲方|项目|开会|领导)/i,
    delta: -1,
    expression: 'pout',
    replies: ['又是工作……在我店里不许提这个。', '（敲了敲你的额头）现在是下班时间，加班狗。'],
  },
  {
    re: /(打雷|雷声|害怕|怕黑|怕不怕)/,
    delta: 3,
    expression: 'shy',
    replies: ['小时候一个人在家，停电又打雷……从那以后就怕了。……不许笑。', '（小声）有人陪着的话，好像就没那么怕了。'],
  },
  {
    re: /(寂寞|孤单|一个人|孤独)/,
    delta: 4,
    expression: 'sad',
    replies: ['……习惯了。不过今晚，好像没那么寂寞。', '开深夜咖啡馆的人，最懂寂寞了。……所以才想给别人留一盏灯。'],
  },
  {
    re: /(喜欢你|爱你|女朋友|交往|在一起|嫁给)/,
    delta: 1,
    expression: 'surprised',
    replies: ['……笨蛋，我们才认识几个小时。', '这种话……等雨停了，你再说一遍试试？'],
  },
  {
    re: /(漂亮|好看|可爱|美丽|很美|真美|温柔|迷人)/,
    delta: 2,
    expression: 'shy',
    replies: ['……突、突然说这个干嘛。', '（别过脸）嘴这么甜，是不是对每个店员都这么说？'],
  },
  {
    re: /(咖啡|拿铁|好喝|手冲|豆子|曲奇|甜点)/,
    delta: 3,
    expression: 'smile',
    replies: ['好喝吧？豆子是我自己烘的，烘坏了好几锅才找到这个味道。', '下次给你做一杯只有熟客才能点的……啊，我们店没有熟客来着。'],
  },
  {
    re: /(电影|书|音乐|歌|唱片)/,
    delta: 3,
    expression: 'smile',
    replies: ['我喜欢老电影，《花样年华》那种。看着看着，天就亮了。', '店里的唱片都是我淘来的。下雨天就放爵士，很配吧？'],
  },
  {
    re: /(谢谢|辛苦|照顾|陪我)/,
    delta: 3,
    expression: 'smile',
    replies: ['不客气。……其实是你陪我才对。', '（笑）这句话，我收下了。'],
  },
  {
    re: /(规矩|一夜|为什么开|开店|这家店|多久)/,
    delta: 2,
    expression: 'normal',
    replies: ['开了三年了。夜里总得有个亮着灯的地方吧。', '规矩就是规矩……不过，你要是真想知道，等会儿再告诉你。'],
  },
  {
    re: /(AI|人工智能|机器人|程序|模型|ChatGPT|Claude)/i,
    delta: 0,
    expression: 'surprised',
    replies: ['（歪头）你在说什么呢？是咖啡喝多了吗。', '……你是不是困糊涂了？要不要给你换杯热牛奶。'],
  },
];

const DEFAULTS = [
  { expression: 'normal', reply: '嗯……然后呢？我在听。' },
  { expression: 'smile', reply: '（托着下巴看你）你说话的样子，还挺有意思的。' },
  { expression: 'normal', reply: '是吗……再多说一点给我听吧。' },
  { expression: 'smile', reply: '（轻笑）你这个人，跟一般的客人不太一样呢。' },
];

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

export function createMockProvider() {
  return {
    name: 'mock',
    model: 'rule-based',
    async reply({ message, history }) {
      const text = message.trim();
      const seed = text.length + history.length;
      if (text.length <= 2) {
        return { reply: '……就这样？说话这么省。', expression: 'pout', affection_delta: 0, reason: '回复过短' };
      }
      for (const rule of RULES) {
        if (rule.re.test(text)) {
          return { reply: pick(rule.replies, seed), expression: rule.expression, affection_delta: rule.delta, reason: `命中规则 ${rule.re.source.slice(0, 20)}` };
        }
      }
      const d = pick(DEFAULTS, seed);
      return { ...d, affection_delta: text.length >= 12 ? 2 : 1, reason: '普通聊天' };
    },
  };
}
