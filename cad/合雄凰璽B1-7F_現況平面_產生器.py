#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
禹合制所 YUHE DESIGN
合雄凰璽 B1／7F  現況平面 CAD 產生器

用途
----
把「現場丈量尺寸」變成可直接開的 CAD 圖（DXF）與可直接看的預覽圖（SVG）。

★★ 重要 ★★
本檔預設的所有尺寸，是依「建商原始平面圖（B1 柒樓）的格局關係」＋「需求表載明
室內實坪約 40 坪」回推出來的【推估值】，不是丈量成果。
在把 8/15 現場丈量的實際數字填進下面的 GRID_X / GRID_Y / 開口表之前，
本圖僅能當作討論用的關係圖，不可用於施工、放樣或估價。

怎麼改成真實丈量圖
------------------
只要改本檔最上面那一段「丈量數據區」：
  1. GRID_X / GRID_Y  ── 各道牆的軸線位置（mm，由左至右／由下至上累加）
  2. T_EXT / T_INT    ── 外牆、隔間牆厚度
  3. OPENINGS         ── 門窗開口（哪一道牆、從哪到哪、是門還是窗）
  4. ROOMS            ── 房間範圍與名稱
改完存檔，執行：
     python3 合雄凰璽B1-7F_現況平面_產生器.py
就會重新產生 DXF 與 SVG，並在終端機印出各室淨面積（坪）與合計，
可以直接跟權狀／實坪對帳。

輸出
----
  合雄凰璽B1-7F_現況平面.dxf        （Big5／ANSI_950，給中文版 AutoCAD）
  合雄凰璽B1-7F_現況平面_UTF8.dxf   （UTF-8，給 QCAD／LibreCAD／SketchUp 等）
  合雄凰璽B1-7F_現況平面.svg        （瀏覽器直接開，手機也能看）

圖面比例 1:50，圖框 A3。單位 mm。
"""

import math
import os

# =====================================================================
#  丈量數據區 —— 只要改這一段
# =====================================================================

CASE_NAME   = "合雄凰璽 B1／7F"
DRAW_TITLE  = "現況平面圖"
SURVEY_DATE = "2026/08/15 現場丈量"
NOTE_STAMP  = "推估底圖．非丈量成果．不可用於施工或估價"   # 校正完請改成 "依現場丈量繪製"

# --- 牆厚（mm）------------------------------------------------------
T_EXT = 200      # 外牆（RC）
T_INT = 120      # 室內隔間
COL   = 500      # 結構柱 邊長

# --- 軸線（mm）：外牆外緣為 0，往右／往上累加 ------------------------
# X：前陽台 | 女兒房1 | 走道 | 廚房 | 後陽台
GRID_X = [0, 1700, 5400, 6800, 10400, 13200]
# Y：主浴/房3 | 主臥 | 客浴 | 廚房.後陽台
GRID_Y = [0, 2600, 4400, 6300, 7400, 10400]

X0, X1, X2, X3, X4, X5 = GRID_X
Y0, Y1, Y2, Y3, Y4, Y5 = GRID_Y

# --- 外牆輪廓（外緣，逆時針）----------------------------------------
# 右側 Y3~Y4 段內縮，形成雨遮凹口
OUTLINE = [
    (X0, Y0), (X5, Y0), (X5, Y3), (X4, Y3),
    (X4, Y4), (X5, Y4), (X5, Y5), (X0, Y5),
]

# --- 房間表：(名稱, x1, y1, x2, y2, 是否計入室內坪) ------------------
ROOMS = [
    ("前陽台",   X0, Y3, X1, Y5, True),
    ("女兒房1",  X1, Y3, X2, Y5, True),
    ("主臥",     X0, Y1, X2, Y3, True),
    ("主浴",     X0, Y0, 3000, Y1, True),
    ("房3",      3000, Y0, X2, Y1, True),
    ("玄關.走道", X2, Y0, X3, Y5, True),
    ("廚房",     X3, Y3, X4, Y5, True),
    ("後陽台",   X4, Y4, X5, Y5, True),
    ("客浴",     X3, Y2, 9000, Y3, True),
    ("餐廳",     9000, Y2, X5, Y3, True),
    ("客廳",     X3, Y0, X5, Y2, True),
    ("雨遮",     X4, Y3, X5, Y4, False),
]

# --- 牆體：("H"|"V", 軸線座標, 起, 迄, 厚度) -------------------------
WALLS = [
    # 外牆（沿 OUTLINE，厚度往內）
    ("H", Y0, X0, X5, T_EXT, "in+"),
    ("H", Y5, X0, X5, T_EXT, "in-"),
    ("V", X0, Y0, Y5, T_EXT, "in+"),
    ("V", X5, Y0, Y3, T_EXT, "in-"),
    ("H", Y3, X4, X5, T_EXT, "in-"),
    ("V", X4, Y3, Y4, T_EXT, "in+"),
    ("H", Y4, X4, X5, T_EXT, "in+"),
    ("V", X5, Y4, Y5, T_EXT, "in-"),
    # 隔間牆（厚度置中）
    ("V", X1, Y3, Y5, T_INT, "mid"),
    ("V", X2, Y0, Y5, T_INT, "mid"),
    ("V", X3, Y2, Y5, T_INT, "mid"),
    ("V", 3000, Y0, Y1, T_INT, "mid"),
    ("V", 9000, Y2, Y3, T_INT, "mid"),
    ("V", X4, Y4, Y5, T_INT, "mid"),
    ("H", Y1, X0, X2, T_INT, "mid"),
    ("H", Y2, X3, 9000, T_INT, "mid"),
    ("H", Y3, X0, X2, T_INT, "mid"),
    ("H", Y3, X3, X4, T_INT, "mid"),
]

# --- 開口表 ---------------------------------------------------------
# ("D"=門 / "W"=窗 / "O"=無門開口,
#  "H"|"V", 軸線座標, 起, 迄, 牆厚, 門樞位置("s"起/"e"迄), 開啟方向(+1/-1))
OPENINGS = [
    # 大門
    ("D", "H", Y0, 5500, 6700, T_EXT, "s", +1),
    # 室內門
    ("D", "V", X2, 8000, 8900, T_INT, "s", +1),    # 女兒房1
    ("D", "V", X2, 4700, 5600, T_INT, "s", +1),    # 主臥
    ("D", "V", X2,  900, 1800, T_INT, "s", +1),    # 房3
    ("D", "H", Y1, 1800, 2700, T_INT, "s", -1),    # 主浴
    ("D", "V", X3, 5100, 6000, T_INT, "s", -1),    # 客浴
    ("D", "V", X3, 7000, 7900, T_INT, "s", +1),    # 廚房
    ("D", "V", X4, 8500, 9400, T_INT, "s", -1),    # 後陽台
    ("D", "V", X1, 7800, 9000, T_INT, "s", +1),    # 前陽台落地門
    # 窗
    ("W", "H", Y5, 2400, 4600, T_EXT, "s", +1),    # 女兒房1
    ("W", "H", Y5, 7400, 9600, T_EXT, "s", +1),    # 廚房
    ("W", "H", Y5, 11000, 12600, T_EXT, "s", +1),  # 後陽台
    ("W", "V", X0, 7000, 9700, T_EXT, "s", +1),    # 前陽台
    ("W", "V", X0, 3200, 5700, T_EXT, "s", +1),    # 主臥
    ("W", "V", X0,  600, 1600, T_EXT, "s", +1),    # 主浴
    ("W", "H", Y0, 3400, 5000, T_EXT, "s", +1),    # 房3
    ("W", "H", Y0, 8000, 12000, T_EXT, "s", +1),   # 客廳落地窗
    ("W", "V", X5, 1500, 4500, T_EXT, "s", +1),    # 客廳
    ("W", "V", X5, 8000, 9800, T_EXT, "s", +1),    # 後陽台
    # 開放（走道通客餐廳）
    ("O", "V", X3, Y0, Y2, T_INT, "s", +1),
]

# --- 結構柱中心 -----------------------------------------------------
COLUMNS = [
    (X0 + COL/2, Y0 + COL/2), (X5 - COL/2, Y0 + COL/2),
    (X0 + COL/2, Y5 - COL/2), (X5 - COL/2, Y5 - COL/2),
    (X3, Y0 + COL/2), (X3, Y5 - COL/2),
    (X4 - COL/2, Y3 - COL/2),
]

# --- 固定設備（現況，供拆除範圍判斷）--------------------------------
# ("rect"|"circle", 圖層, 參數..., 標註)
FIXTURES = [
    # 主浴
    ("rect", 200, 200, 1600, 750, "浴缸"),
    ("rect", 200, 1100, 600, 450, "洗面"),
    ("rect", 1900, 250, 400, 700, "馬桶"),
    ("rect", 200, 1750, 900, 900, "淋浴"),
    # 客浴
    ("rect", 7000, 4600, 400, 700, "馬桶"),
    ("rect", 7600, 4600, 600, 450, "洗面"),
    # 廚房（ㄇ字待改，現況為 L 型）
    ("rect", 7000, 9600, 3200, 600, "流理台"),
    ("rect", 7000, 6500, 600, 3100, "電器櫃"),
]

# --- 尺寸線 ---------------------------------------------------------
DIM_CHAIN_BOTTOM = GRID_X
DIM_CHAIN_LEFT   = GRID_Y

# =====================================================================
#  8/15 現場實測值（自丈量標註圖判讀，單位 cm）
#  這些是「項目級」尺寸，與牆的位置無關，判讀信心高，已直接採用。
#  牆的軸線位置（GRID_X / GRID_Y）仍是推估，需要開間尺寸鏈才能定案。
# =====================================================================

# 業主慣用標註法（判讀自丈量圖）
#   W###        窗寬
#   ⊥ 上/下     上＝窗高，下＝窗台高
#   DW## / DH###  門寬 / 門高
#   H:###       樑下淨高      CH:###  樓板結構高
MEASURED_WINDOWS = [
    # (代號, 窗寬, 窗高, 窗台高, 位置說明, 判讀信心)
    ("W1", 238.4, 191.8, 43.5, "上方外牆（39+4.5）",       "高"),
    ("W2", 237.3, 192.0, 43.5, "下方外牆（39+4.5）",       "高"),
    ("W3", 237.3, 191.5, 44.0, "右上外牆",                 "高"),
    ("W4", 331.0, None,  None, "綠色標註，位置待確認",     "中"),
    ("W5", 118.0, None,  None, "藍色標註 W118，位置待確認", "低"),
]
MEASURED_DOORS = [
    # (代號, 門寬, 門高, 位置說明, 判讀信心)
    ("D1", 90.0, 215.0, "室內門（DW90 / DH215）", "高"),
    ("D2", 78.0, None,  "主浴門（DW78）",         "高"),
]
MEASURED_HEIGHTS = {
    "樓板結構高 CH": 291.6,   # 客廳實測
    "樑下淨高 H":    262.3,   # 實測
}
# 唯一一條判讀信心高的尺寸鏈（沿垂直向，主臥／客廳之間那道牆）
MEASURED_CHAIN = ("50.3 + 18.5 + 314.1 + 20", 402.9)

# 已判讀但「尚未能對應到牆」的實測數字（cm）。
# 這些不進圖，只列在圖面備註，避免誤用。
UNPLACED = [166.6, 147.7, 85.3, 170.5, 251.2, 209.5, 467.2, 197.0, 86.5,
            116.5, 91.6, 206.9, 143.1, 104.0, 106.5, 352.8, 317.2, 96.3,
            83.5, 88.9, 37.2, 30.6, 25.6, 73.5, 60.1, 43.1, 43.3, 58.6]

# =====================================================================
#  以下為繪圖引擎，一般不需要改
# =====================================================================

SCALE = 50.0          # 出圖比例 1:50
def mm(paper_mm):     # 紙上 mm -> 圖面單位
    return paper_mm * SCALE

LAYERS = [
    ("00-圖框",     7,  "#8a8578"),
    ("01-結構牆",   7,  "#1f1f1f"),
    ("02-隔間牆",   8,  "#4a4a4a"),
    ("03-柱",       1,  "#c0563c"),
    ("04-窗",       4,  "#2f8fa8"),
    ("05-門",       3,  "#5c7a52"),
    ("06-陽台雨遮", 9,  "#9a917f"),
    ("07-固定設備", 6,  "#8a6d4b"),
    ("08-尺寸",     2,  "#b8912f"),
    ("09-文字",     5,  "#2b4a7a"),
    ("10-註記",     1,  "#c0563c"),
]
LAYER_COLOR = {n: h for n, _, h in LAYERS}

ENT = []
def line(lay, p1, p2):
    if abs(p1[0]-p2[0]) < 1e-9 and abs(p1[1]-p2[1]) < 1e-9:
        return
    ENT.append({"t": "line", "l": lay, "a": p1, "b": p2})
def arc(lay, c, r, a1, a2):
    ENT.append({"t": "arc", "l": lay, "c": c, "r": r, "a1": a1, "a2": a2})
def circle(lay, c, r):
    ENT.append({"t": "circle", "l": lay, "c": c, "r": r})
def solid(lay, pts):
    ENT.append({"t": "solid", "l": lay, "p": pts})
def text(lay, pos, h, s, center=False, rot=0.0):
    ENT.append({"t": "text", "l": lay, "p": pos, "h": h, "s": s,
                "c": center, "r": rot})
def rect(lay, x1, y1, x2, y2):
    line(lay, (x1, y1), (x2, y1)); line(lay, (x2, y1), (x2, y2))
    line(lay, (x2, y2), (x1, y2)); line(lay, (x1, y2), (x1, y1))

# ---------- 牆體（含開口挖空）----------
def wall_faces(axis, coord, thk, side):
    if side == "mid":
        return coord - thk/2, coord + thk/2
    if side == "in+":
        return coord, coord + thk
    return coord - thk, coord

def openings_on(axis, coord):
    out = []
    for o in OPENINGS:
        if o[1] == axis and abs(o[2] - coord) < 1e-6:
            out.append((min(o[3], o[4]), max(o[3], o[4])))
    return sorted(out)

def draw_wall(axis, coord, s, e, thk, side, lay):
    f1, f2 = wall_faces(axis, coord, thk, side)
    segs, cur = [], min(s, e)
    end = max(s, e)
    for a, b in openings_on(axis, coord):
        a, b = max(a, cur), min(b, end)
        if b <= cur or a >= end:
            continue
        if a > cur:
            segs.append((cur, a))
        cur = max(cur, b)
    if cur < end:
        segs.append((cur, end))
    for a, b in segs:
        if b - a < 1:
            continue
        if axis == "H":
            line(lay, (a, f1), (b, f1)); line(lay, (a, f2), (b, f2))
            line(lay, (a, f1), (a, f2)); line(lay, (b, f1), (b, f2))
        else:
            line(lay, (f1, a), (f1, b)); line(lay, (f2, a), (f2, b))
            line(lay, (f1, a), (f2, a)); line(lay, (f1, b), (f2, b))

# ---------- 門 ----------
LEAF = 40    # 門片厚度 mm

def _swing_angles(a_leaf, a_wall):
    """回傳 (起角, 終角)，使 DXF 由起角逆時針掃 90 度到終角。"""
    if (a_wall - a_leaf) % 360 == 90:
        return a_leaf, a_wall
    return a_wall, a_leaf

def draw_door(axis, coord, s, e, thk, hinge, sw):
    """sw=+1 往座標正向開；hinge='s' 門樞在起點側。"""
    w = e - s
    if axis == "H":
        hx = s if hinge == "s" else e
        d  = 1 if hinge == "s" else -1
        # 門片：垂直牆面，由門樞往 sw 方向立起
        line("05-門", (hx, coord), (hx, coord + sw*w))
        line("05-門", (hx + d*LEAF, coord), (hx + d*LEAF, coord + sw*w))
        line("05-門", (hx, coord), (hx + d*LEAF, coord))
        line("05-門", (hx, coord + sw*w), (hx + d*LEAF, coord + sw*w))
        a1, a2 = _swing_angles(90 if sw > 0 else 270, 0 if d > 0 else 180)
    else:
        hy = s if hinge == "s" else e
        d  = 1 if hinge == "s" else -1
        line("05-門", (coord, hy), (coord + sw*w, hy))
        line("05-門", (coord, hy + d*LEAF), (coord + sw*w, hy + d*LEAF))
        line("05-門", (coord, hy), (coord, hy + d*LEAF))
        line("05-門", (coord + sw*w, hy), (coord + sw*w, hy + d*LEAF))
        a1, a2 = _swing_angles(0 if sw > 0 else 180, 90 if d > 0 else 270)
    c = (hx, coord) if axis == "H" else (coord, hy)
    arc("05-門", c, w, a1, a2)

# ---------- 窗 ----------
def draw_window(axis, coord, s, e, thk, side):
    f1, f2 = wall_faces(axis, coord, thk, side)
    q = (f2 - f1) / 3.0
    for k in range(4):
        v = f1 + q * k
        if axis == "H":
            line("04-窗", (s, v), (e, v))
        else:
            line("04-窗", (v, s), (v, e))
    if axis == "H":
        line("04-窗", (s, f1), (s, f2)); line("04-窗", (e, f1), (e, f2))
    else:
        line("04-窗", (f1, s), (f2, s)); line("04-窗", (f1, e), (f2, e))

# ---------- 尺寸線 ----------
TICK = mm(1.6)
DIMTXT = mm(2.5)

def dim_h(y, x1, x2, above=True):
    line("08-尺寸", (x1, y), (x2, y))
    for x in (x1, x2):
        line("08-尺寸", (x - TICK, y - TICK), (x + TICK, y + TICK))
    text("08-尺寸", ((x1 + x2) / 2, y + (DIMTXT*0.45 if above else -DIMTXT*1.5)),
         DIMTXT, "%d" % round(abs(x2 - x1)), center=True)

def dim_v(x, y1, y2):
    line("08-尺寸", (x, y1), (x, y2))
    for y in (y1, y2):
        line("08-尺寸", (x - TICK, y - TICK), (x + TICK, y + TICK))
    text("08-尺寸", (x - DIMTXT*0.45, (y1 + y2) / 2),
         DIMTXT, "%d" % round(abs(y2 - y1)), center=True, rot=90)

def dim_chain_h(y, xs, ext_from):
    for x in xs:
        line("08-尺寸", (x, ext_from), (x, y - TICK*1.5))
    for a, b in zip(xs, xs[1:]):
        dim_h(y, a, b)
    dim_h(y - mm(9), xs[0], xs[-1])

def dim_chain_v(x, ys, ext_from):
    for y in ys:
        line("08-尺寸", (ext_from, y), (x + TICK*1.5, y))
    for a, b in zip(ys, ys[1:]):
        dim_v(x, a, b)
    dim_v(x + mm(9), ys[0], ys[-1])

# ---------- 面積 ----------
PING = 3.305785
def area_m2(x1, y1, x2, y2, inset=0):
    """inset=0 -> 軸線面積（含牆，對應權狀實坪的計算方式）
       inset>0 -> 扣掉半牆後的淨面積（實際可用地坪）"""
    w = max(0.0, abs(x2 - x1) - inset*2)
    h = max(0.0, abs(y2 - y1) - inset*2)
    return w * h / 1e6

def build_areas():
    """回傳 {房名: [淨面積 m2, 軸線面積 m2, 是否計入室內坪, rect]}"""
    raw = {}
    for name, x1, y1, x2, y2, count in ROOMS:
        thk = T_EXT if name in ("前陽台", "後陽台", "雨遮") else T_INT
        raw[name] = [area_m2(x1, y1, x2, y2, thk / 2),
                     area_m2(x1, y1, x2, y2),
                     count, (x1, y1, x2, y2)]
    return raw

# =====================================================================
#  組圖
# =====================================================================
def build():
    # 牆
    for axis, coord, s, e, thk, side in WALLS:
        lay = "01-結構牆" if thk >= T_EXT else "02-隔間牆"
        draw_wall(axis, coord, s, e, thk, side, lay)
    # 開口
    for kind, axis, coord, s, e, thk, hinge, sw in OPENINGS:
        side = "mid"
        for w in WALLS:
            if w[0] == axis and abs(w[1] - coord) < 1e-6:
                side = w[5]; break
        if kind == "D":
            draw_door(axis, coord, s, e, thk, hinge, sw)
        elif kind == "W":
            draw_window(axis, coord, s, e, thk, side)
    # 柱
    for cx, cy in COLUMNS:
        h = COL / 2
        solid("03-柱", [(cx-h, cy-h), (cx+h, cy-h), (cx+h, cy+h), (cx-h, cy+h)])
        rect("03-柱", cx-h, cy-h, cx+h, cy+h)
    # 陽台.雨遮 地坪示意
    for name, x1, y1, x2, y2, count in ROOMS:
        if name in ("前陽台", "後陽台", "雨遮"):
            step = 600
            k = y1 + step
            while k < y2:
                line("06-陽台雨遮", (x1 + 120, k), (x2 - 120, k))
                k += step
    # 固定設備
    for f in FIXTURES:
        if f[0] == "rect":
            _, x, y, w, h, lb = f
            rect("07-固定設備", x, y, x + w, y + h)
            line("07-固定設備", (x, y), (x + w, y + h))
    # 房名與面積
    areas = build_areas()
    for name, x1, y1, x2, y2, count in ROOMS:
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        a = areas[name][0]
        text("09-文字", (cx, cy + mm(2.2)), mm(4.0), name, center=True)
        text("09-文字", (cx, cy - mm(2.6)), mm(2.6),
             "%.2f m2 / %.2f 坪" % (a, a / PING), center=True)
    # 尺寸
    dim_chain_h(Y0 - mm(14), DIM_CHAIN_BOTTOM, Y0)
    dim_chain_v(X0 - mm(14), DIM_CHAIN_LEFT, X0)
    # 圖框（A3 1:50）
    fw, fh = mm(420), mm(297)
    ox, oy = X0 - mm(46), Y0 - mm(46)
    rect("00-圖框", ox, oy, ox + fw, oy + fh)
    rect("00-圖框", ox + mm(8), oy + mm(8), ox + fw - mm(8), oy + fh - mm(8))
    # 標題欄
    tb_w, tb_h = mm(120), mm(34)
    tx, ty = ox + fw - mm(8) - tb_w, oy + mm(8)
    rect("00-圖框", tx, ty, tx + tb_w, ty + tb_h)
    line("00-圖框", (tx, ty + mm(22)), (tx + tb_w, ty + mm(22)))
    line("00-圖框", (tx, ty + mm(11)), (tx + tb_w, ty + mm(11)))
    text("09-文字", (tx + mm(4), ty + mm(26)), mm(5.0), "禹合制所 YUHE DESIGN")
    text("09-文字", (tx + mm(4), ty + mm(15)), mm(4.2), CASE_NAME + "  " + DRAW_TITLE)
    text("09-文字", (tx + mm(4), ty + mm(4.5)), mm(3.0),
         "比例 1:50  單位 mm  " + SURVEY_DATE)
    # 警語
    text("10-註記", (ox + mm(12), oy + fh - mm(18)), mm(5.0), "[ " + NOTE_STAMP + " ]")
    # 面積合計
    net = sum(v[0] for v in areas.values() if v[2])
    ax  = sum(v[1] for v in areas.values() if v[2])
    text("09-文字", (ox + mm(12), oy + mm(16)), mm(3.4),
         "室內軸線面積（含牆.含陽台）%.2f m2 = %.2f 坪　／　扣牆淨地坪 %.2f 坪"
         % (ax, ax / PING, net / PING))
    text("09-文字", (ox + mm(12), oy + mm(10)), mm(3.0),
         "權狀 58 坪／需求表載明室內實坪約 40 坪．估價以實坪為準")
    # 8/15 實測值（項目級，已確認）
    ty0 = oy + fh - mm(30)
    text("10-註記", (ox + mm(12), ty0), mm(3.4), "8/15 現場實測（已判讀確認）")
    lines = ["樓板結構高 CH %.1f ／ 樑下淨高 H %.1f"
             % (MEASURED_HEIGHTS["樓板結構高 CH"], MEASURED_HEIGHTS["樑下淨高 H"])]
    for c, w, h, sh, note, conf in MEASURED_WINDOWS:
        if h is None:
            lines.append("%s 窗寬 %.1f（%s）" % (c, w, note))
        else:
            lines.append("%s 窗寬 %.1f ／ 窗高 %.1f ／ 窗台高 %.1f" % (c, w, h, sh))
    for c, w, h, note, conf in MEASURED_DOORS:
        lines.append("%s %s" % (c, note))
    lines.append("尺寸鏈 %s = %.1f" % (MEASURED_CHAIN[0], MEASURED_CHAIN[1]))
    lines.append("單位 cm．牆的軸線位置仍為推估，待開間尺寸鏈補齊")
    for i, t in enumerate(lines):
        text("09-文字", (ox + mm(12), ty0 - mm(5.2) * (i + 1)), mm(2.6), t)
    return areas

# =====================================================================
#  DXF 輸出（R12 / AC1009）
# =====================================================================
def dxf_bytes(encoding):
    o = []
    def g(code, val):
        o.append(str(code)); o.append(str(val))
    xs = [p for e in ENT for p in
          ([e["a"][0], e["b"][0]] if e["t"] == "line" else
           [e["c"][0]-e["r"], e["c"][0]+e["r"]] if e["t"] in ("arc", "circle") else
           [q[0] for q in e["p"]] if e["t"] == "solid" else [e["p"][0]])]
    ys = [p for e in ENT for p in
          ([e["a"][1], e["b"][1]] if e["t"] == "line" else
           [e["c"][1]-e["r"], e["c"][1]+e["r"]] if e["t"] in ("arc", "circle") else
           [q[1] for q in e["p"]] if e["t"] == "solid" else [e["p"][1]])]
    g(0, "SECTION"); g(2, "HEADER")
    g(9, "$ACADVER"); g(1, "AC1009")
    g(9, "$DWGCODEPAGE"); g(3, "ANSI_950" if encoding == "big5" else "UTF8")
    g(9, "$INSUNITS"); g(70, 4)
    g(9, "$EXTMIN"); g(10, min(xs)); g(20, min(ys)); g(30, 0.0)
    g(9, "$EXTMAX"); g(10, max(xs)); g(20, max(ys)); g(30, 0.0)
    g(0, "ENDSEC")

    g(0, "SECTION"); g(2, "TABLES")
    g(0, "TABLE"); g(2, "LTYPE"); g(70, 1)
    g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line")
    g(72, 65); g(73, 0); g(40, 0.0)
    g(0, "ENDTAB")
    g(0, "TABLE"); g(2, "STYLE"); g(70, 1)
    g(0, "STYLE"); g(2, "STANDARD"); g(70, 0); g(40, 0.0); g(41, 0.85)
    g(50, 0.0); g(71, 0); g(42, 2.5); g(3, "txt"); g(4, "")
    g(0, "ENDTAB")
    g(0, "TABLE"); g(2, "LAYER"); g(70, len(LAYERS))
    for name, col, _ in LAYERS:
        g(0, "LAYER"); g(2, name); g(70, 0); g(62, col); g(6, "CONTINUOUS")
    g(0, "ENDTAB")
    g(0, "ENDSEC")

    g(0, "SECTION"); g(2, "ENTITIES")
    for e in ENT:
        if e["t"] == "line":
            g(0, "LINE"); g(8, e["l"])
            g(10, e["a"][0]); g(20, e["a"][1]); g(30, 0.0)
            g(11, e["b"][0]); g(21, e["b"][1]); g(31, 0.0)
        elif e["t"] == "arc":
            g(0, "ARC"); g(8, e["l"])
            g(10, e["c"][0]); g(20, e["c"][1]); g(30, 0.0)
            g(40, e["r"]); g(50, e["a1"]); g(51, e["a2"])
        elif e["t"] == "circle":
            g(0, "CIRCLE"); g(8, e["l"])
            g(10, e["c"][0]); g(20, e["c"][1]); g(30, 0.0); g(40, e["r"])
        elif e["t"] == "solid":
            p = e["p"]
            g(0, "SOLID"); g(8, e["l"])
            g(10, p[0][0]); g(20, p[0][1]); g(30, 0.0)
            g(11, p[1][0]); g(21, p[1][1]); g(31, 0.0)
            g(12, p[3][0]); g(22, p[3][1]); g(32, 0.0)
            g(13, p[2][0]); g(23, p[2][1]); g(33, 0.0)
        elif e["t"] == "text":
            g(0, "TEXT"); g(8, e["l"])
            g(10, e["p"][0]); g(20, e["p"][1]); g(30, 0.0)
            g(40, e["h"]); g(1, e["s"]); g(50, e.get("r", 0.0)); g(7, "STANDARD")
            if e["c"]:
                g(72, 1); g(11, e["p"][0]); g(21, e["p"][1]); g(31, 0.0)
    g(0, "ENDSEC"); g(0, "EOF")
    txt = "\r\n".join(o) + "\r\n"
    return txt.encode(encoding, errors="replace")

# =====================================================================
#  SVG 預覽
# =====================================================================
def svg_text():
    pad = 400
    xs, ys = [], []
    for e in ENT:
        if e["t"] == "line":
            xs += [e["a"][0], e["b"][0]]; ys += [e["a"][1], e["b"][1]]
        elif e["t"] in ("arc", "circle"):
            xs += [e["c"][0]-e["r"], e["c"][0]+e["r"]]
            ys += [e["c"][1]-e["r"], e["c"][1]+e["r"]]
        elif e["t"] == "solid":
            xs += [q[0] for q in e["p"]]; ys += [q[1] for q in e["p"]]
        else:
            xs.append(e["p"][0]); ys.append(e["p"][1])
    mnx, mxx, mny, mxy = min(xs)-pad, max(xs)+pad, min(ys)-pad, max(ys)+pad
    W, H = mxx-mnx, mxy-mny
    def X(v): return v - mnx
    def Y(v): return mxy - v
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.0f %.0f" '
           'width="100%%" style="background:#faf8f4;font-family:\'Noto Sans TC\','
           '\'Microsoft JhengHei\',sans-serif">' % (W, H)]
    for e in ENT:
        c = LAYER_COLOR.get(e["l"], "#333")
        sw = 45 if e["l"] == "01-結構牆" else 30 if e["l"] == "02-隔間牆" else 18
        if e["t"] == "line":
            out.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" '
                       'stroke-width="%d"/>' % (X(e["a"][0]), Y(e["a"][1]),
                                                X(e["b"][0]), Y(e["b"][1]), c, sw))
        elif e["t"] == "circle":
            out.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="none" stroke="%s" '
                       'stroke-width="%d"/>' % (X(e["c"][0]), Y(e["c"][1]), e["r"], c, sw))
        elif e["t"] == "arc":
            a1, a2 = math.radians(e["a1"]), math.radians(e["a2"])
            x1 = e["c"][0] + e["r"]*math.cos(a1); y1 = e["c"][1] + e["r"]*math.sin(a1)
            x2 = e["c"][0] + e["r"]*math.cos(a2); y2 = e["c"][1] + e["r"]*math.sin(a2)
            large = 1 if (e["a2"] - e["a1"]) % 360 > 180 else 0
            out.append('<path d="M %.1f %.1f A %.1f %.1f 0 %d 1 %.1f %.1f" fill="none" '
                       'stroke="%s" stroke-width="%d"/>'
                       % (X(x1), Y(y1), e["r"], e["r"], large, X(x2), Y(y2), c, sw))
        elif e["t"] == "solid":
            pts = " ".join("%.1f,%.1f" % (X(p[0]), Y(p[1])) for p in e["p"])
            out.append('<polygon points="%s" fill="%s" fill-opacity="0.55"/>' % (pts, c))
        elif e["t"] == "text":
            anchor = "middle" if e["c"] else "start"
            rot = ' transform="rotate(%.0f %.1f %.1f)"' % (-e.get("r", 0.0),
                                                           X(e["p"][0]), Y(e["p"][1])) \
                  if e.get("r") else ""
            out.append('<text x="%.1f" y="%.1f" font-size="%.0f" fill="%s" '
                       'text-anchor="%s"%s>%s</text>'
                       % (X(e["p"][0]), Y(e["p"][1]) + e["h"]*0.35, e["h"], c,
                          anchor, rot,
                          e["s"].replace("&", "&amp;").replace("<", "&lt;")))
    out.append("</svg>")
    return "\n".join(out)

# =====================================================================
def main():
    areas = build()
    here = os.path.dirname(os.path.abspath(__file__))
    base = "合雄凰璽B1-7F_現況平面"
    with open(os.path.join(here, base + ".dxf"), "wb") as f:
        f.write(dxf_bytes("big5"))
    with open(os.path.join(here, base + "_UTF8.dxf"), "wb") as f:
        f.write(dxf_bytes("utf-8"))
    with open(os.path.join(here, base + ".svg"), "w", encoding="utf-8") as f:
        f.write(svg_text())

    print("=" * 58)
    print("  %s %s" % (CASE_NAME, DRAW_TITLE))
    print("  【%s】" % NOTE_STAMP)
    print("=" * 58)
    print("  %-10s %12s %12s" % ("空間", "軸線(坪)", "淨地坪(坪)"))
    print("-" * 58)
    net = ax = 0.0
    for name, *_ , count in ROOMS:
        n, a = areas[name][0], areas[name][1]
        mark = "" if count else "  (不計入室內坪)"
        print("  %-10s %12.2f %12.2f%s" % (name, a / PING, n / PING, mark))
        if count:
            net += n; ax += a
    print("-" * 58)
    print("  %-10s %12.2f %12.2f" % ("室內合計", ax / PING, net / PING))
    print()
    print("  對帳：需求表載明室內實坪約 40 坪（對應軸線面積）")
    print("        軸線 %.2f 坪　差異 %+.2f 坪" % (ax / PING, ax / PING - 40))
    print("        扣牆後實際可用地坪 %.2f 坪（含陽台）" % (net / PING))
    print("=" * 58)
    print("  8/15 現場實測（已判讀，直接採用）")
    print("    樓板結構高 CH %.1f cm ／ 樑下淨高 H %.1f cm"
          % (MEASURED_HEIGHTS["樓板結構高 CH"], MEASURED_HEIGHTS["樑下淨高 H"]))
    for c, w, h, sh, note, conf in MEASURED_WINDOWS:
        print("    %s 窗寬 %-6.1f 窗高 %-7s 窗台高 %-6s 信心%s  %s"
              % (c, w, h if h else "-", sh if sh else "-", conf, note))
    for c, w, h, note, conf in MEASURED_DOORS:
        print("    %s 門寬 %-6.1f 門高 %-7s 信心%s  %s"
              % (c, w, h if h else "-", conf, note))
    print("    尺寸鏈 %s = %.1f cm" % (MEASURED_CHAIN[0], MEASURED_CHAIN[1]))
    print("  尚未能對應到牆的實測數字 %d 筆（見 丈量標註判讀表）" % len(UNPLACED))
    print("=" * 58)
    print("  已輸出：")
    print("    %s.dxf        (Big5，中文版 AutoCAD)" % base)
    print("    %s_UTF8.dxf   (UTF-8，QCAD/LibreCAD/SketchUp)" % base)
    print("    %s.svg        (瀏覽器直接開)" % base)

if __name__ == "__main__":
    main()
