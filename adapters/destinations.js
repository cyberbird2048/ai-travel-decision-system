/*
 * 目的地知识库：机场、落地交通、美食、娱乐、线路素材。
 * 这是"按需接入接口"之前的兜底数据层——接口未配置时规划仍然可用，
 * 数据均为公开常识性信息，价格为量级参考，出行前请以官方为准。
 */
(function () {
  const DESTINATIONS = {
    "香港": {
      city: "Hong Kong", airports: [{ code: "HKG", name: "香港国际机场" }],
      currency: "HKD", timezone: "Asia/Hong_Kong",
      transit: [
        { mode: "机场快线", to: "香港站/九龙站", duration: "24 分钟", price: "HKD 115", note: "最快，市区预办登机可用" },
        { mode: "城巴 A11/A21", to: "港岛/九龙", duration: "45–70 分钟", price: "HKD 33–40", note: "性价比高，看夜景线路" },
        { mode: "的士", to: "市区", duration: "30–45 分钟", price: "HKD 250–350", note: "红色市区的士，深夜首选" }
      ],
      food: [
        { name: "添好运", type: "点心", area: "深水埗", note: "米其林平价点心，酥皮叉烧包" },
        { name: "麦奀云吞面世家", type: "云吞面", area: "中环", note: "老字号细蓉" },
        { name: "兰芳园", type: "茶餐厅", area: "中环", note: "丝袜奶茶发源地" },
        { name: "九记牛腩", type: "牛腩面", area: "上环", note: "清汤腩，排队但值得" },
        { name: "庙街夜市大排档", type: "大排档", area: "油麻地", note: "煲仔饭与炒蟹" }
      ],
      fun: [
        { name: "太平山顶", type: "观景", time: "傍晚至夜间", note: "缆车上山看维港夜景" },
        { name: "M+ 博物馆", type: "艺术", time: "日间", note: "西九文化区当代视觉文化" },
        { name: "龙脊徒步", type: "户外", time: "日间", note: "港岛径第八段，亚洲最佳市区徒步之一" },
        { name: "天星小轮", type: "体验", time: "傍晚", note: "尖沙咀—中环，百年渡轮" },
        { name: "大馆", type: "历史街区", time: "日间", note: "中环旧警署活化建筑群" }
      ]
    },
    "东京": {
      city: "Tokyo", airports: [{ code: "NRT", name: "成田国际机场" }, { code: "HND", name: "羽田机场" }],
      currency: "JPY", timezone: "Asia/Tokyo",
      transit: [
        { mode: "N'EX 成田特快", to: "东京/新宿", duration: "55–85 分钟", price: "JPY 3,070", note: "NRT 落地首选，往返票有优惠" },
        { mode: "京急线", to: "品川", duration: "15–20 分钟", price: "JPY 330", note: "HND 落地性价比最高" },
        { mode: "利木津巴士", to: "各大酒店", duration: "60–120 分钟", price: "JPY 3,600", note: "行李多、直达酒店" }
      ],
      food: [
        { name: "筑地场外市场", type: "海鲜", area: "筑地", note: "早餐吃玉子烧和海胆饭" },
        { name: "一兰拉面", type: "拉面", area: "涩谷/新宿", note: "豚骨拉面一人食隔间" },
        { name: "阿夫利 AFURI", type: "拉面", area: "惠比寿", note: "柚子盐拉面清爽派" },
        { name: "薮蕎麦", type: "荞麦面", area: "神田", note: "百年老店" },
        { name: "焼肉ライク", type: "烧肉", area: "多店", note: "一人烧肉快餐化" }
      ],
      fun: [
        { name: "浅草寺 & 仲见世", type: "文化", time: "早晨", note: "赶在人流前到雷门" },
        { name: "涩谷天空展望台", type: "观景", time: "日落", note: "Shibuya Sky 提前订票" },
        { name: "teamLab Planets", type: "艺术", time: "日间", note: "沉浸式数字艺术，需预约" },
        { name: "明治神宫", type: "自然", time: "上午", note: "市中心的森林参道" },
        { name: "新宿黄金街", type: "夜生活", time: "夜间", note: "小酒馆巷弄文化" }
      ]
    },
    "大阪": {
      city: "Osaka", airports: [{ code: "KIX", name: "关西国际机场" }],
      currency: "JPY", timezone: "Asia/Tokyo",
      transit: [
        { mode: "南海电铁 Rapi:t", to: "难波", duration: "39 分钟", price: "JPY 1,490", note: "铁人 28 号造型特急" },
        { mode: "JR 关空快速", to: "天王寺/大阪站", duration: "50–70 分钟", price: "JPY 1,210", note: "JR Pass 可用" },
        { mode: "机场巴士", to: "梅田/难波", duration: "50–60 分钟", price: "JPY 1,800", note: "行李多首选" }
      ],
      food: [
        { name: "道顿堀章鱼烧", type: "小吃", area: "道顿堀", note: "本家大たこ排队王" },
        { name: "北极星蛋包饭", type: "洋食", area: "心斋桥", note: "蛋包饭发源老店" },
        { name: "黑门市场", type: "市场", area: "日本桥", note: "河豚、和牛串边走边吃" },
        { name: "一芳亭", type: "烧卖", area: "难波", note: "蛋皮烧卖八十年老店" }
      ],
      fun: [
        { name: "大阪城公园", type: "历史", time: "上午", note: "天守阁与护城河" },
        { name: "环球影城 USJ", type: "乐园", time: "全天", note: "超级任天堂世界需抽整理券" },
        { name: "梅田蓝天大厦", type: "观景", time: "日落", note: "空中庭园展望台" },
        { name: "新世界 & 通天阁", type: "街区", time: "夜间", note: "昭和风串炸街" }
      ]
    },
    "曼谷": {
      city: "Bangkok", airports: [{ code: "BKK", name: "素万那普机场" }, { code: "DMK", name: "廊曼机场" }],
      currency: "THB", timezone: "Asia/Bangkok",
      transit: [
        { mode: "ARL 机场快线", to: "Phaya Thai", duration: "26 分钟", price: "THB 45", note: "BKK 落地避堵首选" },
        { mode: "Grab / Bolt", to: "市区", duration: "40–90 分钟", price: "THB 300–500", note: "定价透明，避开高峰" },
        { mode: "机场的士", to: "市区", duration: "40–90 分钟", price: "THB 350–500 + 高速费", note: "认准官方排队通道打表" }
      ],
      food: [
        { name: "Jay Fai", type: "米其林街头", area: "旧城", note: "蟹肉欧姆蛋，需预约" },
        { name: "Thipsamai", type: "泰式炒河粉", area: "旧城", note: "Pad Thai 老字号" },
        { name: "唐人街耀华力路", type: "夜市", area: "Yaowarat", note: "晚间海鲜与粿条" },
        { name: "Or Tor Kor 市场", type: "市场", area: "Chatuchak", note: "高档生鲜与熟食" }
      ],
      fun: [
        { name: "大皇宫 & 玉佛寺", type: "文化", time: "早晨", note: "着装有要求，早去避热" },
        { name: "湄南河夜游", type: "体验", time: "夜间", note: "郑王庙夜景" },
        { name: "恰图恰周末市场", type: "购物", time: "周末日间", note: "上万摊位，早上人少" },
        { name: "天台酒吧", type: "夜生活", time: "夜间", note: "Vertigo / Sky Bar 看城景" },
        { name: "泰式按摩", type: "放松", time: "任意", note: "Health Land 连锁靠谱" }
      ]
    },
    "新加坡": {
      city: "Singapore", airports: [{ code: "SIN", name: "樟宜机场" }],
      currency: "SGD", timezone: "Asia/Singapore",
      transit: [
        { mode: "MRT 东西线", to: "市区", duration: "45 分钟", price: "SGD 2", note: "性价比最高" },
        { mode: "Grab", to: "市区", duration: "20–30 分钟", price: "SGD 25–35", note: "深夜或行李多" },
        { mode: "机场的士", to: "市区", duration: "20–30 分钟", price: "SGD 25–40", note: "打表 + 机场附加费" }
      ],
      food: [
        { name: "麦士威熟食中心", type: "熟食中心", area: "牛车水", note: "天天海南鸡饭" },
        { name: "老巴刹沙嗲街", type: "沙嗲", area: "CBD", note: "傍晚封街烧烤" },
        { name: "松发肉骨茶", type: "肉骨茶", area: "克拉码头", note: "胡椒汤底" },
        { name: "珍宝海鲜", type: "辣椒蟹", area: "河畔", note: "国菜级辣椒螃蟹" }
      ],
      fun: [
        { name: "滨海湾花园", type: "地标", time: "傍晚", note: "19:45/20:45 灯光秀免费" },
        { name: "圣淘沙", type: "海岛", time: "全天", note: "环球影城 + 海滩" },
        { name: "夜间野生动物园", type: "动物", time: "夜间", note: "全球首个夜间动物园" },
        { name: "小印度 & 甘榜格南", type: "街区", time: "日间", note: "多元文化街区徒步" }
      ]
    },
    "首尔": {
      city: "Seoul", airports: [{ code: "ICN", name: "仁川国际机场" }, { code: "GMP", name: "金浦机场" }],
      currency: "KRW", timezone: "Asia/Seoul",
      transit: [
        { mode: "AREX 直达", to: "首尔站", duration: "43 分钟", price: "KRW 11,000", note: "整点直达不停站" },
        { mode: "AREX 普通", to: "首尔站", duration: "59 分钟", price: "KRW 4,750", note: "T-money 卡可刷" },
        { mode: "机场巴士 6000 系", to: "各区", duration: "60–90 分钟", price: "KRW 17,000", note: "直达明洞/江南酒店圈" }
      ],
      food: [
        { name: "广藏市场", type: "市场", area: "钟路", note: "绿豆饼、麻药紫菜包饭" },
        { name: "土俗村参鸡汤", type: "参鸡汤", area: "景福宫", note: "老屋里的一人一锅" },
        { name: "王妃家", type: "烤肉", area: "明洞", note: "韩牛烤肉体验店" },
        { name: "圣水洞咖啡街", type: "咖啡", area: "圣水", note: "工厂改造咖啡厂牌聚集" }
      ],
      fun: [
        { name: "景福宫", type: "文化", time: "上午", note: "穿韩服免门票，看换岗仪式" },
        { name: "北村韩屋村", type: "街区", time: "日间", note: "注意居民区静音" },
        { name: "N 首尔塔", type: "观景", time: "日落", note: "南山缆车上山" },
        { name: "弘大", type: "夜生活", time: "夜间", note: "街头演出与酒吧" },
        { name: "汉江公园", type: "休闲", time: "傍晚", note: "外卖炸鸡野餐" }
      ]
    },
    "台北": {
      city: "Taipei", airports: [{ code: "TPE", name: "桃园国际机场" }, { code: "TSA", name: "松山机场" }],
      currency: "TWD", timezone: "Asia/Taipei",
      transit: [
        { mode: "机场捷运直达车", to: "台北车站", duration: "39 分钟", price: "TWD 150", note: "紫色直达车，市区预办登机" },
        { mode: "客运巴士 1819", to: "台北车站", duration: "55–70 分钟", price: "TWD 140", note: "24 小时有班次" },
        { mode: "的士", to: "市区", duration: "40–60 分钟", price: "TWD 1,100–1,300", note: "深夜落地首选" }
      ],
      food: [
        { name: "鼎泰丰", type: "小笼包", area: "信义/新生", note: "本店在信义路" },
        { name: "阜杭豆浆", type: "早餐", area: "善导寺", note: "厚饼夹蛋要早起排队" },
        { name: "宁夏夜市", type: "夜市", area: "大同区", note: "本地人最爱的小型夜市" },
        { name: "永康牛肉面", type: "牛肉面", area: "永康街", note: "红烧半筋半肉" }
      ],
      fun: [
        { name: "台北 101", type: "观景", time: "日落", note: "89 楼观景台" },
        { name: "象山步道", type: "户外", time: "傍晚", note: "拍 101 夜景机位" },
        { name: "故宫博物院", type: "文化", time: "日间", note: "翠玉白菜与肉形石" },
        { name: "九份老街", type: "近郊", time: "下午至夜", note: "山城茶馆看海" }
      ]
    }
  };

  window.Destinations = {
    all: () => Object.keys(DESTINATIONS),
    get: (name) => DESTINATIONS[name] || null
  };
})();
