from pathlib import Path
from PIL import Image,ImageDraw
p=Path('work/screenshots/c1');dest=p/'并排';dest.mkdir(exist_ok=True);count=0
for a in sorted(p.glob('*-1440.png')):
 b=p/(a.stem[:-5]+'-390.png')
 if not b.exists()or a.name.startswith('failure-'):continue
 x,y=Image.open(a).convert('RGB'),Image.open(b).convert('RGB');canvas=Image.new('RGB',(x.width+y.width+24,max(x.height,y.height)+40),'#ffffff');canvas.paste(x,(0,40));canvas.paste(y,(x.width+24,40));d=ImageDraw.Draw(canvas);d.text((12,10),'1440 px',(30,30,30));d.text((x.width+36,10),'390 px',(30,30,30));canvas.save(dest/(a.stem[:-5]+'.png'));count+=1
print('paired screenshots',count)
