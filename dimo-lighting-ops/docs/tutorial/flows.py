import html
ROLE = {  # fill, stroke/text
 'Sales':        ('#E8F0FE','#1D4ED8'),
 'SM Projects':  ('#F1E8FD','#6D28D9'),
 'Design Manager':('#E0F5F3','#0F766E'),
 'Designer / Engineer':('#E6F4EA','#1E8E3E'),
 'SM Estimation':('#FDEEE3','#C2410C'),
 'Estimator':    ('#FBF3DB','#946200'),
 'GM / DGM':     ('#FDECEE','#C8102E'),
 'Operations':   ('#EEF0F3','#475569'),
 'System':       ('#F3F4F6','#6B7280'),
 'Client':       ('#FFFFFF','#111827'),
}
def esc(s): return html.escape(s)
def wrap(text, width_px, fs):
    maxc = max(6, int(width_px/(fs*0.53)))
    out=[]
    for para in text.split('\n'):
        line=''
        for w in para.split(' '):
            if len(line)+len(w)+(1 if line else 0) <= maxc: line=(line+' '+w).strip()
            else:
                if line: out.append(line)
                line=w
        out.append(line)
    return out
def textblock(x,y,w,h,text,fs=9,color='#111827',bold_first=False):
    lines=wrap(text,w-8,fs); lh=fs*1.18
    y0=y+h/2-(len(lines)-1)*lh/2+fs*0.35
    s=''
    for i,l in enumerate(lines):
        wt='700' if bold_first else '400'
        s+=f'<text x="{x+w/2}" y="{y0+i*lh:.1f}" font-size="{fs}" text-anchor="middle" fill="{color}" font-weight="{wt}">{esc(l)}</text>'
    return s
ARROWDEF='''<defs>
<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#374151"/></marker>
<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#C8102E"/></marker>
</defs>'''

class Swim:
    def __init__(s, lanes, cols, W=1100, lab=118, lane_h=78, head=0, nw=None, fs=8.6):
        s.lanes=lanes; s.cols=cols; s.W=W; s.lab=lab; s.lh=lane_h; s.head=head
        s.cw=(W-lab-10)/cols; s.nw=nw or s.cw-14; s.nh=lane_h-18; s.fs=fs
        s.nodes={}; s.body=''; s.edges=''
    def pos(s,key):
        return s.nodes[key]
    def node(s,key,lane,col,text,kind='act'):
        li=s.lanes.index(lane)
        x=s.lab+col*s.cw+(s.cw-s.nw)/2; y=s.head+li*s.lh+(s.lh-s.nh)/2
        fill,stroke=ROLE.get(lane,('#fff','#111'))
        if kind=='appr':
            s.body+=f'<rect x="{x}" y="{y}" width="{s.nw}" height="{s.nh}" rx="8" fill="#fff" stroke="#C8102E" stroke-width="2"/>'
            s.body+=f'<circle cx="{x+s.nw-2}" cy="{y+2}" r="7" fill="#C8102E"/><text x="{x+s.nw-2}" y="{y+5.2}" font-size="9" text-anchor="middle" fill="#fff" font-weight="700">✓</text>'
        elif kind=='end':
            s.body+=f'<rect x="{x}" y="{y}" width="{s.nw}" height="{s.nh}" rx="{s.nh/2}" fill="{stroke}" stroke="{stroke}"/>'
        else:
            s.body+=f'<rect x="{x}" y="{y}" width="{s.nw}" height="{s.nh}" rx="6" fill="#fff" stroke="{stroke}" stroke-width="1.4"/>'
        s.body+=textblock(x,y,s.nw,s.nh,text,s.fs,'#fff' if kind=='end' else '#111827')
        s.nodes[key]=(x,y,s.nw,s.nh)
    def edge(s,a,b,label='',dashed=False,red=False,mode='auto',lx=None,ly=None):
        ax,ay,aw,ah=s.nodes[a]; bx,by,bw,bh=s.nodes[b]
        st=f'stroke="{"#C8102E" if red else "#374151"}" stroke-width="1.3" fill="none" marker-end="url(#{"arr" if red else "ar"})"'
        if dashed: st+=' stroke-dasharray="4 3"'
        if mode=='back':  # return loop underneath
            x1=ax+aw*0.3; y1=ay+ah; x2=bx+bw*0.7; y2=by+bh
            yy=max(y1,y2)+8
            d=f'M{x1},{y1} L{x1},{yy} L{x2},{yy} L{x2},{y2+1}'
            tx,ty=(x1+x2)/2, yy+9
        elif abs((ax)-(bx))<1:  # same column vertical
            if by>ay: d=f'M{ax+aw/2},{ay+ah} L{bx+bw/2},{by-1}'; tx,ty=ax+aw/2+4,(ay+ah+by)/2
            else: d=f'M{ax+aw/2},{ay} L{bx+bw/2},{by+bh+1}'; tx,ty=ax+aw/2+4,(ay+by+bh)/2
        elif abs(ay-by)<1:
            d=f'M{ax+aw},{ay+ah/2} L{bx-1},{by+bh/2}'; tx,ty=(ax+aw+bx)/2,ay+ah/2-4
        else:
            ex=bx-9 if mode!='early' else ax+aw+9
            d=f'M{ax+aw},{ay+ah/2} L{ex},{ay+ah/2} L{ex},{by+bh/2} L{bx-1},{by+bh/2}'
            tx,ty=(ax+aw+ex)/2, ay+ah/2-4
            if mode=='early': tx,ty=ex+3,(ay+by+bh)/2
        s.edges+=f'<path d="{d}" {st}/>'
        if label:
            if lx is not None: tx,ty=lx,ly
            anchor='start' if (mode=='early' or abs(ax-bx)<1) else 'middle'
            s.edges+=f'<text x="{tx}" y="{ty}" font-size="7.8" fill="{"#C8102E" if red else "#374151"}" text-anchor="{anchor}" font-style="italic" paint-order="stroke" stroke="#fff" stroke-width="3">{esc(label)}</text>'
    def svg(s):
        H=s.head+len(s.lanes)*s.lh+14
        g=''
        for i,l in enumerate(s.lanes):
            fill,stroke=ROLE.get(l,('#f6f7f9','#111'))
            y=s.head+i*s.lh
            g+=f'<rect x="0" y="{y}" width="{s.W}" height="{s.lh}" fill="{fill if i%2==0 else "#fff"}" opacity="{0.55 if i%2==0 else 1}"/>'
            g+=f'<rect x="0" y="{y}" width="{s.lab-8}" height="{s.lh}" fill="{fill}"/><rect x="0" y="{y}" width="5" height="{s.lh}" fill="{stroke}"/>'
            g+=textblock(6,y,s.lab-16,s.lh,l,10,stroke,True)
            g+=f'<line x1="0" y1="{y+s.lh}" x2="{s.W}" y2="{y+s.lh}" stroke="#e5e7eb"/>'
        return f'<svg viewBox="0 0 {s.W} {H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Liberation Sans, Arial, sans-serif">{ARROWDEF}{g}{s.edges}{s.body}</svg>'
