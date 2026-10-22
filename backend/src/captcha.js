// 图形验证码生成（SVG，零第三方依赖，风格与学习鸭一致：130x46 深蓝字符+干扰线+噪点）
const CAPTCHA_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randInt(max) {
  return Math.floor(Math.random() * max);
}

/** 生成 4 位验证码文本 */
export function randomCaptchaText(len = 4) {
  let s = '';
  for (let i = 0; i < len; i += 1) s += CAPTCHA_CHARS[randInt(CAPTCHA_CHARS.length)];
  return s;
}

/** 生成 SVG 验证码 dataURL（base64） */
export function makeCaptchaSvg(text, w = 130, h = 46) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="#F5FBFE"/>`,
  ];
  // 干扰线（浅灰蓝，5 条）
  for (let i = 0; i < 5; i += 1) {
    const c = `rgb(${150 + randInt(56)},${150 + randInt(56)},${150 + randInt(56)})`;
    parts.push(
      `<line x1="${randInt(w)}" y1="${randInt(h)}" x2="${randInt(w)}" y2="${randInt(h)}" stroke="${c}" stroke-width="1"/>`,
    );
  }
  // 字符（错开高度、深蓝字）
  const step = (w - 16) / text.length;
  for (let i = 0; i < text.length; i += 1) {
    const x = 8 + i * step + randInt(5);
    const y = 3 + randInt(7);
    const c = `rgb(${20 + randInt(51)},${55 + randInt(51)},${105 + randInt(61)})`;
    parts.push(
      `<text x="${x}" y="${y + 30}" font-size="30" font-family="Arial, sans-serif" font-weight="bold" fill="${c}">${text[i]}</text>`,
    );
  }
  // 噪点
  for (let i = 0; i < 220; i += 1) {
    const c = `rgb(${randInt(191)},${randInt(191)},${randInt(191)})`;
    parts.push(`<circle cx="${randInt(w)}" cy="${randInt(h)}" r="0.8" fill="${c}"/>`);
  }
  parts.push('</svg>');
  return 'data:image/svg+xml;base64,' + Buffer.from(parts.join('')).toString('base64');
}
