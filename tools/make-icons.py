"""生成「语音笔记」的全部图标。

用法： python tools/make-icons.py
输出：
  icons/icon-192.png / icon-512.png / icon-maskable-512.png     —— PWA 图标
  android/app/src/main/res/mipmap-*/ic_launcher.png             —— 安卓传统图标
  android/app/src/main/res/mipmap-*/ic_launcher_round.png       —— 安卓圆形图标
  android/app/src/main/res/mipmap-*/ic_launcher_foreground.png  —— 安卓自适应图标前景
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
PWA_DIR = os.path.join(PROJECT, "icons")
# 两套安卓工程共用同一套图标：WebView 外壳版 + 纯原生版
RES_DIRS = [
    os.path.join(PROJECT, "android", "app", "src", "main", "res"),
    os.path.join(PROJECT, "android-native", "app", "src", "main", "res"),
]

VIOLET = np.array([124, 108, 255], dtype=np.float64)
BLUE = np.array([78, 168, 255], dtype=np.float64)
S = 512  # 设计基准尺寸

# 安卓各密度：(目录后缀, 传统图标边长, 自适应前景边长)
DENSITIES = [
    ("mdpi", 48, 108),
    ("hdpi", 72, 162),
    ("xhdpi", 96, 216),
    ("xxhdpi", 144, 324),
    ("xxxhdpi", 192, 432),
]


def gradient(size, c1, c2):
    """左上到右下的线性渐变。"""
    y, x = np.mgrid[0:size, 0:size]
    t = (x + y) / (2 * (size - 1))
    rgb = c1[None, None, :] * (1 - t[..., None]) + c2[None, None, :] * t[..., None]
    return Image.fromarray(rgb.astype("uint8"), "RGB").convert("RGBA")


def rounded_mask(size, radius, scale=1.0):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(radius * scale), fill=255
    )
    return mask


def circle_mask(size):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    return mask


def draw_mic(size, color=(255, 255, 255, 255), shadow=True):
    """在透明图层上画一个经典麦克风图形。"""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    k = size / S

    cx = 256 * k
    body_w = 92 * k
    line = max(2, round(26 * k))

    d.rounded_rectangle(
        [cx - body_w / 2, 102 * k, cx + body_w / 2, 262 * k],
        radius=body_w / 2, fill=color,
    )

    arc_r = 118 * k
    d.arc([cx - arc_r, 144 * k, cx + arc_r, 380 * k], start=0, end=180, fill=color, width=line)
    cap_r = line / 2
    for sx in (cx - arc_r, cx + arc_r):
        sy = 262 * k
        d.ellipse([sx - cap_r, sy - cap_r, sx + cap_r, sy + cap_r], fill=color)

    d.rounded_rectangle(
        [cx - line / 2, 380 * k - line / 2, cx + line / 2, 410 * k],
        radius=line / 2, fill=color,
    )
    d.rounded_rectangle(
        [cx - 58 * k, 410 * k - line / 2, cx + 58 * k, 410 * k + line / 2],
        radius=line / 2, fill=color,
    )

    if not shadow:
        return layer

    alpha = layer.split()[3].filter(ImageFilter.GaussianBlur(9 * k))
    shadow_layer = Image.new("RGBA", (size, size), (30, 20, 90, 110))
    shadow_layer.putalpha(alpha)
    shifted = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shifted.paste(shadow_layer, (0, int(8 * k)), shadow_layer)
    return Image.alpha_composite(shifted, layer)


# ----------------------------------------------------------------- PWA

def build_pwa(size, maskable=False):
    bg = gradient(size, VIOLET, BLUE)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    if maskable:
        icon.paste(bg, (0, 0))
        inner = int(size * 0.72)
        icon.alpha_composite(draw_mic(inner), ((size - inner) // 2, (size - inner) // 2))
    else:
        icon.paste(bg, (0, 0), rounded_mask(size, 116, scale=size / S))
        icon.alpha_composite(draw_mic(size))
    return icon


# ----------------------------------------------------------------- Android

def build_android_legacy(size, round_icon=False):
    """传统启动图标：渐变底 + 麦克风。圆形版本用圆形遮罩。"""
    bg = gradient(size, VIOLET, BLUE)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = circle_mask(size) if round_icon else rounded_mask(size, 116, scale=size / S)
    icon.paste(bg, (0, 0), mask)
    icon.alpha_composite(draw_mic(size))
    return icon


def build_android_foreground(size):
    """
    自适应图标前景：必须是透明背景。
    前景画布是 108dp，系统只会显示中间约 72dp，所以图形要缩到画布中央，
    这里把麦克风画在 66% 的子画布上再居中粘贴。
    """
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = max(8, int(round(size * 0.66)))
    mic = draw_mic(inner)
    icon.alpha_composite(mic, ((size - inner) // 2, (size - inner) // 2))
    return icon


def main():
    os.makedirs(PWA_DIR, exist_ok=True)
    for name, image in [
        ("icon-192.png", build_pwa(192)),
        ("icon-512.png", build_pwa(512)),
        ("icon-maskable-512.png", build_pwa(512, maskable=True)),
    ]:
        path = os.path.join(PWA_DIR, name)
        image.save(path, "PNG", optimize=True)
        print(f"PWA      {path}")

    for res_dir in RES_DIRS:
        if not os.path.isdir(os.path.dirname(res_dir)):
            print(f"跳过安卓图标：找不到 {res_dir}")
            continue
        for suffix, legacy, foreground in DENSITIES:
            out_dir = os.path.join(res_dir, f"mipmap-{suffix}")
            os.makedirs(out_dir, exist_ok=True)
            targets = [
                ("ic_launcher.png", build_android_legacy(legacy)),
                ("ic_launcher_round.png", build_android_legacy(legacy, round_icon=True)),
                ("ic_launcher_foreground.png", build_android_foreground(foreground)),
            ]
            for name, image in targets:
                image.save(os.path.join(out_dir, name), "PNG", optimize=True)
        print(f"Android  {os.path.relpath(res_dir, PROJECT)}: 5 种密度已生成")


if __name__ == "__main__":
    main()
