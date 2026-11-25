# coding: utf-8
"""用未经改写的用户PNG与实际浏览器截图并排；只读图，不修饰实现截图。"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,hashlib
root=Path(__file__).resolve().parent.parent
shots=root/'work/screenshots/stage10a';ref=root/'dev/ui-components/reference/Main.png'
font=None
for name in ['/System/Library/Fonts/STHeiti Light.ttc','/System/Library/Fonts/Supplemental/Arial Unicode.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
    try:font=ImageFont.truetype(name,22);break
    except OSError:pass
if font is None:font=ImageFont.load_default()
results=[]
for section in ['main','lab']:
    for width in [1440,390]:
        source=shots/f'{section}-{width}.png'
        a=Image.open(ref).convert('RGB');b=Image.open(source).convert('RGB')
        image=Image.new('RGB',(a.width+b.width+24,max(a.height,b.height)+64),'#f4f2f7')
        image.paste(a,(0,64));image.paste(b,(a.width+24,64))
        draw=ImageDraw.Draw(image)
        draw.text((20,20),'用户原始参照 Main.png · 1440px（未重绘/缩放）',font=font,fill='#1e1a26')
        label=f'阶段A实际截图 · {width}px '+('规范区' if section=='main' else '扩展交互区')
        if width==390:label='实际390px · '+('规范区' if section=='main' else '扩展区')
        draw.text((a.width+36,20),label,font=font,fill='#1e1a26')
        dest=shots/f'compare-{section}-{width}.png';image.save(dest)
        results.append({'file':dest.name,'left':'Main.png原图1:1','right':source.name,'right_viewport':width,'note':'原图未提供390px规范专版；移动端是同一组件自适应，非像素一致声明。' if width==390 else '扩展区为任务书A要求，原Main未包含其全部状态。' if section=='lab' else '以已知差异清单说明字体/样例/尺寸差别。'})
(shots/'comparison-index.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'comparisons':len(results),'reference_sha256':hashlib.sha256(ref.read_bytes()).hexdigest()},ensure_ascii=False))
