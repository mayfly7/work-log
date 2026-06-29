/**
 * 每日诗词库——经典古诗词及名句
 * 每首包含：作者、正文/名句、出处
 */

import { requestUrl } from "obsidian";

export interface Poem {
  author: string;
  text: string;
  source?: string;
  /** 完整正文（API 返回的全诗），用于点击展开 */
  fullText?: string[];
}

export const POEMS: Poem[] = [
  { author: "苏轼", text: "人生如逆旅，我亦是行人。", source: "《临江仙·送钱穆父》" },
  { author: "苏轼", text: "竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。", source: "《定风波》" },
  { author: "苏轼", text: "但愿人长久，千里共婵娟。", source: "《水调歌头》" },
  { author: "苏轼", text: "回首向来萧瑟处，归去，也无风雨也无晴。", source: "《定风波》" },
  { author: "苏轼", text: "博观而约取，厚积而薄发。", source: "《稼说送张琥》" },
  { author: "李白", text: "长风破浪会有时，直挂云帆济沧海。", source: "《行路难》" },
  { author: "李白", text: "天生我材必有用，千金散尽还复来。", source: "《将进酒》" },
  { author: "李白", text: "仰天大笑出门去，我辈岂是蓬蒿人。", source: "《南陵别儿童入京》" },
  { author: "李白", text: "大鹏一日同风起，扶摇直上九万里。", source: "《上李邕》" },
  { author: "杜甫", text: "会当凌绝顶，一览众山小。", source: "《望岳》" },
  { author: "杜甫", text: "读书破万卷，下笔如有神。", source: "《奉赠韦左丞丈二十二韵》" },
  { author: "杜甫", text: "文章千古事，得失寸心知。", source: "《偶题》" },
  { author: "王维", text: "行到水穷处，坐看云起时。", source: "《终南别业》" },
  { author: "王维", text: "大漠孤烟直，长河落日圆。", source: "《使至塞上》" },
  { author: "陶渊明", text: "采菊东篱下，悠然见南山。", source: "《饮酒》" },
  { author: "陶渊明", text: "盛年不重来，一日难再晨。及时当勉励，岁月不待人。", source: "《杂诗》" },
  { author: "白居易", text: "野火烧不尽，春风吹又生。", source: "《赋得古原草送别》" },
  { author: "白居易", text: "日出江花红胜火，春来江水绿如蓝。", source: "《忆江南》" },
  { author: "王之涣", text: "欲穷千里目，更上一层楼。", source: "《登鹳雀楼》" },
  { author: "刘禹锡", text: "沉舟侧畔千帆过，病树前头万木春。", source: "《酬乐天扬州初逢席上见赠》" },
  { author: "刘禹锡", text: "莫道桑榆晚，为霞尚满天。", source: "《酬乐天咏老见示》" },
  { author: "陆游", text: "山重水复疑无路，柳暗花明又一村。", source: "《游山西村》" },
  { author: "陆游", text: "纸上得来终觉浅，绝知此事要躬行。", source: "《冬夜读书示子聿》" },
  { author: "王安石", text: "不畏浮云遮望眼，自缘身在最高层。", source: "《登飞来峰》" },
  { author: "文天祥", text: "人生自古谁无死，留取丹心照汗青。", source: "《过零丁洋》" },
  { author: "郑燮", text: "千磨万击还坚劲，任尔东西南北风。", source: "《竹石》" },
  { author: "朱熹", text: "问渠那得清如许，为有源头活水来。", source: "《观书有感》" },
  { author: "辛弃疾", text: "众里寻他千百度，蓦然回首，那人却在灯火阑珊处。", source: "《青玉案·元夕》" },
  { author: "辛弃疾", text: "了却君王天下事，赢得生前身后名。", source: "《破阵子》" },
  { author: "曹操", text: "老骥伏枥，志在千里。烈士暮年，壮心不已。", source: "《龟虽寿》" },
  { author: "屈原", text: "路漫漫其修远兮，吾将上下而求索。", source: "《离骚》" },
  { author: "荀子", text: "不积跬步，无以至千里；不积小流，无以成江海。", source: "《劝学》" },
  { author: "老子", text: "千里之行，始于足下。", source: "《道德经》" },
  { author: "韩愈", text: "业精于勤，荒于嬉；行成于思，毁于随。", source: "《进学解》" },
  { author: "诸葛亮", text: "非淡泊无以明志，非宁静无以致远。", source: "《诫子书》" },
  { author: "范仲淹", text: "先天下之忧而忧，后天下之乐而乐。", source: "《岳阳楼记》" },
  { author: "王勃", text: "海内存知己，天涯若比邻。", source: "《送杜少府之任蜀州》" },
  { author: "李商隐", text: "春蚕到死丝方尽，蜡炬成灰泪始干。", source: "《无题》" },
  { author: "孟郊", text: "春风得意马蹄疾，一日看尽长安花。", source: "《登科后》" },
  { author: "杜牧", text: "停车坐爱枫林晚，霜叶红于二月花。", source: "《山行》" },
  { author: "李绅", text: "谁知盘中餐，粒粒皆辛苦。", source: "《悯农》" },
  { author: "于谦", text: "粉骨碎身浑不怕，要留清白在人间。", source: "《石灰吟》" },
  { author: "龚自珍", text: "落红不是无情物，化作春泥更护花。", source: "《己亥杂诗》" },
  { author: "高适", text: "莫愁前路无知己，天下谁人不识君。", source: "《别董大》" },
  { author: "晏殊", text: "无可奈何花落去，似曾相识燕归来。", source: "《浣溪沙》" },
  { author: "李清照", text: "生当作人杰，死亦为鬼雄。", source: "《夏日绝句》" },
  { author: "岳飞", text: "莫等闲，白了少年头，空悲切。", source: "《满江红》" },
  { author: "颜真卿", text: "黑发不知勤学早，白首方悔读书迟。", source: "《劝学》" },
  { author: "陈子昂", text: "前不见古人，后不见来者。念天地之悠悠，独怆然而涕下。", source: "《登幽州台歌》" },
  { author: "张九龄", text: "海上生明月，天涯共此时。", source: "《望月怀远》" },
];

/** API 返回的诗数据 */
interface PoemApiData {
  title: string;
  content: string[];
  author: { name: string };
  dynasty: { name: string };
}

/**
 * 从 API 获取随机诗词，失败时返回 null
 * @param skipCache 跳过每日缓存，强制刷新
 */
let cachedPoem: Poem | null = null;
let cacheDate = "";

export async function fetchDailyPoem(skipCache = false): Promise<Poem | null> {
  const today = new Date().toISOString().slice(0, 10);
  if (!skipCache && cacheDate === today && cachedPoem) return cachedPoem;

  try {
    let data: PoemApiData | null = null;
    // 最多重试 3 次，过滤掉古文长赋
    for (let attempt = 0; attempt < 3; attempt++) {
      const resp = await requestUrl({ url: "https://poetry.palemoky.com/api/poems/random" });
      const d = resp.json.data as PoemApiData;
      // 过滤条件：超过 16 句 或 超过 200 字视为古文/赋，跳过重试
      if (d.content.length <= 16 && d.content.join("").length <= 200) {
        data = d;
        break;
      }
    }
    if (!data) return null;

    // ≤8 句且 ≤56 字显示全文，长诗显示前两句
    const d = data;
    const lines = d.content;
    const isShort = lines.length <= 8 && lines.join("").length <= 56;
    const selected = isShort ? lines : lines.slice(0, 2);
    const text = formatCouplets(selected).join("，");

    const poem: Poem = {
      author: `${d.dynasty.name} · ${d.author.name}`,
      text,
      source: `《${d.title}》`,
      fullText: d.content, // 保存完整正文
    };
    cachedPoem = poem;
    cacheDate = today;
    return poem;
  } catch {
    return null;
  }
}

/**
 * 基于日期种子选取本地诗词，同一天固定返回同一首
 */
export function getDailyPoem(seed: string): Poem {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  const index = Math.abs(hash) % POEMS.length;
  return POEMS[index];
}

/**
 * 将诗句数组格式化为两句一联
 * 智能处理已有标点，避免 `。，` 和 `。。` 重复
 */
export function formatCouplets(lines: string[]): string[] {
  const ends = /[。？！，]$/;
  const couplets: string[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const a = lines[i];
    const b = lines[i + 1];
    if (!b) {
      couplets.push(a);
    } else {
      const sep = ends.test(a) ? "" : "，";
      const end = ends.test(b) ? "" : "。";
      couplets.push(a + sep + b + end);
    }
  }
  return couplets;
}

/**
 * 将诗句数组格式化为逐句分行（弹窗显示用）
 * 奇句加逗号，偶句加句号，已有标点则跳过
 */
export function formatPoemLines(lines: string[]): string[] {
  const ends = /[。？！，]$/;
  return lines.map((line, i) => {
    // 最后一句不加标点
    if (i === lines.length - 1) return line;
    // 偶句索引（0-based 奇数）加句号，奇句加逗号
    const punct = i % 2 === 0 ? "，" : "。";
    return ends.test(line) ? line : line + punct;
  });
}
