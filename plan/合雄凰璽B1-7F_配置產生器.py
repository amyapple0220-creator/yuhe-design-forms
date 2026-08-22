#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
合雄凰璽 B1／7F  平面配置提案 v2
主軸：中央長吧台 × 環狀動線 × 去客廳化（投影取代電視）
座標系沿用育瑄「現況暨拆除圖」，可直接疊圖。單位 mm。
"""
import ezdxf
PING = 3.305785
SRC  = "plan2.dxf"
OUT  = "/home/user/yuhe-design-forms/plan/合雄凰璽B1-7F_平面配置提案_v2.dxf"

ROOMS = [
    ("主浴",      2950,11400, 5600,14060, "乾濕分離＋電熱水器．沿用西北管道間"),
    ("客浴",      2950, 9200, 5600,11400, "增設 160 浴缸．沿用西中管道間"),
    ("更衣間",    5600,10300, 7300,11500, "步入式．單側金屬吊衣桿＋門片"),
    ("主臥",      5600,10300, 9350,14060, "WIN-A．加強隔音．床頭可移（已扣更衣間）"),
    ("女兒房1",   9350,10300,12350,14060, "WIN-B．姊姊房，初期姊妹共用"),
    ("女兒房2",  12350,10300,15350,14060, "WIN-C．先作遊戲間．與女兒房1等大"),
    ("幫傭房",   15350,10300,16850,14060, "小間兼儲藏"),
    ("走道",      5600, 8450,13100,10300, "串連玄關－核心－臥室帶"),
    ("玄關",     13100, 8450,15930,10300, "落塵區＋屏風＋整面到頂櫃 深70"),
    ("餐廚核心",  4350, 3400,13100, 8450, "廚房＋長吧台島＋投影起居．無隔間"),
]
T, TS = 120, 180
WALLS = [
    ("H",10300, 5600,16850, T),
    ("V", 5600, 9200,14060, T),
    ("H",11400, 2950, 5600, T),
    ("H", 9200, 2950, 5600, T),
    ("V", 7300,10300,11500, T),
    ("H",11500, 5600, 7300, T),
    ("V", 9350,10300,14060, TS),
    ("V",12350,10300,14060, T),
    ("V",15350,10300,14060, T),
    ("H", 8450, 5600,15930, T),
    ("V",13100, 8450,10300, T),
]
OPEN = [
    ("D","V", 5600,12300,13100),   # 主臥 → 主浴
    ("D","V", 5600, 9400,10300),   # 走道 → 客浴
    ("D","H",11500, 5800, 6700),   # 主臥 → 更衣間
    ("D","H",10300, 7700, 8600),   # 走道 → 主臥
    ("D","H",10300,10300,11200),   # 走道 → 女兒房1
    ("D","H",10300,13300,14200),   # 走道 → 女兒房2
    ("D","H",10300,15700,16500),   # 走道 → 幫傭房
    ("O","H", 8450, 5800, 7400),   # 走道 → 核心（西口）
    ("O","H", 8450,11000,12800),   # 走道 → 核心（東口）
    ("O","V",13100, 8600, 9700),   # 玄關 → 走道
]
FURN = [
    ("廚具 ㄇ字",      7300, 3520,11500, 4120),
    ("",               7300, 4120, 7900, 5000),
    ("",              10900, 4120,11500, 5000),
    ("長吧台島 420×100",7300, 5200,11500, 6200),
    ("投影矮櫃 深40",   7800, 8050,11000, 8450),
    ("電動幕 120吋",    7900, 8380,10560, 8450),
    ("單椅",            4700, 6500, 5600, 7400),
    ("單椅",            5850, 6500, 6750, 7400),
    ("長凳",            4500, 4600, 6600, 5050),
    ("餐邊儲藏 深50",  12500, 4500,13000, 8000),
    ("床 180×200",      6675,12060, 8475,14060),
    ("化妝桌",          7420,11600, 8920,12100),
    ("單人床",          9500,12060,10550,14060),
    ("單人床",         10750,12060,11800,14060),
    ("書桌／收納",      9470,10420,12230,10920),
    ("收納櫃",         12470,10420,15230,10920),
    ("遊戲地墊",       12800,11600,14900,13600),
    ("床／儲藏",       15470,12160,16730,14060),
    ("到頂櫃 深70",    13220, 9600,15810,10300),
    ("屏風",           13100, 8450,13220, 9400),
    ("吊衣桿 深60",     5720,10420, 6320,11380),
    ("淋浴 90×90",      3070,13160, 3970,14060),
    ("浴櫃／面盆",      4200,13460, 5480,14060),
    ("馬桶",            3070,11520, 3470,12220),
    ("浴缸 160×75",     3850, 9320, 5450,10070),
    ("馬桶",            3070, 9320, 3470,10020),
    ("洗手台",          3070,10400, 3820,10900),
]

def build():
    src = ezdxf.readfile(SRC); smsp = src.modelspace()
    d = ezdxf.new("R2010", setup=True); msp = d.modelspace()
    for n,c in [("現況-結構牆",7),("現況-窗",4),("現況-門",3),("待確認拆除",6),
                ("提案-隔間",1),("提案-家具",8),("提案-文字",5),("提案-開口",3)]:
        if n not in d.layers: d.layers.add(n, color=c)
    DEMO=[(9320,3400,11621,6450),(7672,3550,8420,6450)]
    def isdemo(pts):
        xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
        for a,b,c,e2 in DEMO:
            if a-40<=min(xs) and max(xs)<=c+40 and b-40<=min(ys) and max(ys)<=e2+40:
                return True
        return False
    LM={"WALL-RC":"現況-結構牆","WALL-BRK":"現況-結構牆","WINDOW":"現況-窗","DOOR":"現況-門"}
    for e in smsp:
        L=LM.get(e.dxf.layer)
        if not L: continue
        a={"layer":L}
        if e.dxftype()=="LINE": msp.add_line(e.dxf.start,e.dxf.end,dxfattribs=a)
        elif e.dxftype()=="LWPOLYLINE":
            pts=[(p[0],p[1]) for p in e.get_points()]
            if L=="現況-結構牆" and isdemo(pts): a={"layer":"待確認拆除"}
            msp.add_lwpolyline(pts,close=bool(e.closed),dxfattribs=a)
        elif e.dxftype()=="ARC":
            msp.add_arc(e.dxf.center,e.dxf.radius,e.dxf.start_angle,e.dxf.end_angle,dxfattribs=a)

    def ops(ax,c): return sorted((min(o[3],o[4]),max(o[3],o[4]))
                                 for o in OPEN if o[1]==ax and abs(o[2]-c)<1e-6)
    for ax,c,s,e,t in WALLS:
        f1,f2=c-t/2,c+t/2
        segs=[];cur=min(s,e);end=max(s,e)
        for a,b in ops(ax,c):
            a,b=max(a,cur),min(b,end)
            if b<=cur or a>=end: continue
            if a>cur: segs.append((cur,a))
            cur=max(cur,b)
        if cur<end: segs.append((cur,end))
        for a,b in segs:
            if b-a<1: continue
            p=[(a,f1),(b,f1),(b,f2),(a,f2)] if ax=="H" else [(f1,a),(f1,b),(f2,b),(f2,a)]
            msp.add_lwpolyline(p,close=True,dxfattribs={"layer":"提案-隔間"})
    for kind,ax,c,s,e in OPEN:
        w=e-s
        if kind=="D":
            if ax=="H":
                msp.add_line((s,c),(s,c+w),dxfattribs={"layer":"提案-開口"})
                msp.add_arc((s,c),w,0,90,dxfattribs={"layer":"提案-開口"})
            else:
                msp.add_line((c,s),(c+w,s),dxfattribs={"layer":"提案-開口"})
                msp.add_arc((c,s),w,0,90,dxfattribs={"layer":"提案-開口"})
        else:
            p=[(s,c),(e,c)] if ax=="H" else [(c,s),(c,e)]
            msp.add_lwpolyline(p,dxfattribs={"layer":"提案-開口"})
    for lb,x1,y1,x2,y2 in FURN:
        msp.add_lwpolyline([(x1,y1),(x2,y1),(x2,y2),(x1,y2)],close=True,
                           dxfattribs={"layer":"提案-家具"})
        if lb:
            msp.add_text(lb,height=110,dxfattribs={"layer":"提案-文字"}).set_placement(
                ((x1+x2)/2,(y1+y2)/2), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
    DEDUCT={"主臥":("更衣間",)}
    raw={n:(x2-x1)*(y2-y1)/1e6 for n,x1,y1,x2,y2,_ in ROOMS}
    tot=0
    print("  %-10s %9s %8s  %s"%("空間","m²","坪","備註"))
    print("  "+"-"*76)
    for n,x1,y1,x2,y2,note in ROOMS:
        a=raw[n]-sum(raw[k] for k in DEDUCT.get(n,())); tot+=a
        cx,cy=(x1+x2)/2,(y1+y2)/2
        if n=="餐廚核心": cy=7600
        msp.add_text(n,height=240,dxfattribs={"layer":"提案-文字"}).set_placement(
            (cx,cy+150),align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        msp.add_text("%.2f坪"%(a/PING),height=160,dxfattribs={"layer":"提案-文字"}).set_placement(
            (cx,cy-190),align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        print("  %-10s %9.2f %8.2f  %s"%(n,a,a/PING,note))
    print("  "+"-"*76)
    print("  %-10s %9.2f %8.2f  （軸線面積，未扣牆）"%("合計",tot,tot/PING))
    # 環狀動線淨距檢核
    print("\n  長吧台島 4200×1000 四周淨距：")
    for lb,v in [("南（至廚具前緣）",5200-4120),("北（至投影矮櫃）",8050-6200),
                 ("西（至西外牆）",7300-4350),("東（至東牆）",13100-11500)]:
        print("     %-16s %5.0f mm  %s"%(lb,v,"OK" if v>=900 else "過窄"))
    d.saveas(OUT); print("\n  已輸出 %s"%OUT)

if __name__=="__main__": build()
