/* ============================================================
 * 站点配置 —— 部署前只需要改这一个文件
 * ============================================================
 * 1. 注册 Supabase（https://supabase.com）并新建项目后，
 *    在 Project Settings → API 中复制 URL 和 anon public key 填到下面。
 * 2. 在 Supabase SQL Editor 中执行 supabase-schema.sql。
 * 3. 不填（保持占位符）时网站自动进入「本地演示模式」，
 *    数据存在浏览器 localStorage，用于先看效果。
 * ============================================================ */

const CONFIG = {
  // ↓↓ 替换成你的 Supabase 项目信息 ↓↓
  SUPABASE_URL: "https://zfmxbtbnlenjbjpaahzo.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_vp0f4hIDCvWY8T_Ur64eqw_MmIhWvup",

  // 站点信息
  SITE_NAME: "人情世故段位测评",
  SITE_TAGLINE: "测一测你的社交智慧段位",
  // 结果长图底部展示的站点地址（部署到 GitHub Pages 后填写）
  SITE_URL: "https://yourname.github.io/assessment-site/",

  // 管理后台密码（线上模式：与数据库 app_config 中存储的 SHA-256 值比对）
  // 演示模式默认密码：admin888
  ADMIN_HINT: "管理密码在数据库 app_config 表中设置",

  // 每个密码默认可用次数
  DEFAULT_MAX_USES: 3,

  // 「好评有礼」提示文案（配合淘宝店铺使用，留空则不显示）
  GIFT_NOTE: "回到店铺完成好评，截图联系客服可获赠 1 次测评机会",
};

// 判断是否已配置 Supabase
CONFIG.isConfigured =
  !CONFIG.SUPABASE_URL.includes("YOUR_PROJECT") &&
  !CONFIG.SUPABASE_ANON_KEY.includes("YOUR_ANON");
