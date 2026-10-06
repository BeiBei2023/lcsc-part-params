#!/usr/bin/env node
/**
 * lcsc.mjs —— 用立创商城的公开页面拿物料参数（不需要任何 API 密钥）
 *
 * 用法：node lcsc.mjs <立创编号 或 型号> [更多...]
 * Node 18+，零依赖。
 */
const UA = "lcsc-part-params/1.0"; // 写上自己工具的名字即可，不需要伪装浏览器

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
if (args.length === 0) {
  console.error("用法：node lcsc.mjs <立创编号 或 型号> [更多...]");
  console.error("示例：node lcsc.mjs C42411897");
  console.error("      node lcsc.mjs RTL8189FTV");
  process.exit(1);
}

const getJson = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
};

/** ① 型号 → 立创编号（输入本身就是 C 开头的编号时可以跳过） */
async function findCode(keyword) {
  const data = await getJson(
    `https://easyeda.com/api/eda/product/search?keyword=${encodeURIComponent(keyword)}&page=1&pageSize=10`,
  );
  const hit = data?.result?.productList?.[0];
  if (!hit) throw new Error(`没有找到这个型号：${keyword}`);
  return hit.number; // 形如 C42411897
}

/** ② 编号 → 商品 ID（商品页地址用的是 ID，不是编号） */
async function findProductId(code) {
  const info = (
    await getJson(`https://easyeda.com/api/products/${code}/components?version=6.4.19.5`)
  )?.result;
  if (!info?.lcsc?.id) throw new Error(`没有拿到商品 ID：${code}`);
  return info.lcsc.id; // 形如 44398166
}

/** ③ 商品 ID → 参数（参数就在商品页 HTML 的 __NEXT_DATA__ 里） */
async function readItem(id) {
  const res = await fetch(`https://item.szlcsc.com/${id}.html`, {
    headers: { "user-agent": UA },
  });
  const html = await res.text();
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) throw new Error("页面结构可能变了");
  const web = JSON.parse(raw).props.pageProps.webData;
  const rec = web.productRecord ?? {};
  const files = (rec.fileTypeVOList ?? []).flatMap((group) => group.detailVOList ?? []);
  const pdf =
    rec.pdfFileDetailVO?.fileUrl ??
    files.find((file) => String(file.fileUrl ?? "").toLowerCase().endsWith(".pdf"))?.fileUrl;
  return {
    品名: rec.productName,
    型号: rec.productModel,
    品牌: web.brandVO?.brandName,
    封装: rec.encapsulationModel,
    分类: web.currentCatalog?.catalogName,
    最小包装: `${rec.productMinEncapsulationNumber ?? ""}${rec.productMinEncapsulationUnit ?? ""}`,
    数据手册: pdf ? `https://atta.szlcsc.com${pdf}` : "", // 注意这个域名
    参数: (web.paramList ?? []).map((p) => `${p.parameterName}=${p.parameterDetailValue}`),
  };
}

for (const input of args) {
  try {
    const code = /^c\d+/i.test(input) ? input.toUpperCase() : await findCode(input);
    const id = await findProductId(code);
    console.log(JSON.stringify({ 编号: code, ...(await readItem(id)) }, null, 2));
  } catch (error) {
    // 优雅失败：单个失败不影响其它
    console.error(`✗ ${input}：${error instanceof Error ? error.message : String(error)}`);
  }
}
