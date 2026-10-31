import sys
from PIL import Image, ImageDraw, ImageFont
nr, scene, f, title = sys.argv[1:5]
base=f"{__import__('os').path.dirname(__import__('os').path.abspath(__file__))}/../screens/{nr}/"
a=Image.open(base+'vorher/'+f).convert('RGB'); b=Image.open(base+'nachher/'+f).convert('RGB')
w,h=a.size; s=0.5; a=a.resize((int(w*s),int(h*s))); b=b.resize((int(w*s),int(h*s))); w,h=a.size
top=70; gap=12
im=Image.new('RGB',(2*w+gap, h+top),'white'); im.paste(a,(0,top)); im.paste(b,(w+gap,top))
d=ImageDraw.Draw(im)
try: F=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',20); G=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
except: F=G=ImageFont.load_default()
d.text((8,6),f"{scene}: {title}",fill='black',font=F)
d.text((8,40),"Vorher",fill='#555',font=G); d.text((w+gap+8,40),"Nachher",fill='#555',font=G)
im.save(base+'vergleich/'+f)
