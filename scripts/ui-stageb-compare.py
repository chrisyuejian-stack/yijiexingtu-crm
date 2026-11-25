from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json
r=Path(__file__).resolve().parent.parent;s=r/'work/screenshots/stage10b';ref=r/'dev/ui-components/reference';font=ImageFont.truetype('/System/Library/Fonts/STHeiti Light.ttc',20);rows=[]
for key,board in [('login','LoginDesktop'),('side','StaffSide'),('home','Home'),('week','Week'),('students','Students'),('student-detail','Students')]:
 for width in [1440,390]:
  name='LoginMobile' if key=='login' and width==390 else board
  a=Image.open(ref/(name+'.png')).convert('RGB');b=Image.open(s/f'{key}-{width}.png').convert('RGB');out=Image.new('RGB',(a.width+b.width+24,max(a.height,b.height)+60),'#f4f2f7');out.paste(a,(0,60));out.paste(b,(a.width+24,60));draw=ImageDraw.Draw(out);draw.text((12,15),'原始参照 '+name+'（1:1）',font=font,fill='#1e1a26');draw.text((a.width+36,15),f'实际 {width}px · '+key,font=font,fill='#1e1a26');dest=f'compare-{key}-{width}.png';out.save(s/dest);rows.append({'file':dest,'reference':name+'.png','actual':f'{key}-{width}.png','note':'参照和截图均不重绘、不缩放；除登录外无对应390手机画板，按同一组件自适应；详情抽屉以Students及A规范为依据。'})
(s/'comparison-index.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print('12张逐页并排对照已生成')
