"""Create synthetic samples only; never overwrite existing files."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1] / "demo-files"


def create_demo():
    ROOT.mkdir(exist_ok=True)
    texts = {
        "IMG_20261102_001.md": "# 线性代数课程笔记\n\n人工构造样例，不含真实个人资料。\n\n## 本周学习\n- 矩阵的秩与线性变换\n- 特征值与特征向量\n- 习题：对角化与二次型\n",
        "download_3.txt": "社团读书会活动通知\n人工构造样例，不代表真实活动。\n主题：一本书，一段新的旅程\n请自行核对活动日期，未提供日期时不要推测。\n",
        "receipt_example.txt": "报销明细核对说明（人工样例）\n商户：样例文具店\n金额：38.50 元\n此文件不是有效票据，仅用于文本分类与重命名测试。\n本版不导出票据表格。\n",
        "unknown_notes.txt": "这是人工构造的普通短文本。没有明确的分类信息，请人工判断。\n",
        "unsupported.docx": "This is NOT a real DOCX. Synthetic unsupported-file test only.\n",
    }
    for name, text in texts.items():
        path = ROOT / name
        if not path.exists():
            with path.open("x", encoding="utf-8") as out:
                out.write(text)
    image_path = ROOT / "screenshot_004.png"
    if not image_path.exists():
        image = Image.new("RGB", (900, 620), "#f1f3e9")
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((70, 60, 830, 560), radius=20, fill="#ffffff", outline="#dce3ce", width=2)
        font_path = Path("C:/Windows/Fonts/msyh.ttc")
        font = ImageFont.truetype(str(font_path), 30) if font_path.exists() else ImageFont.load_default(size=30)
        small = ImageFont.truetype(str(font_path), 20) if font_path.exists() else ImageFont.load_default(size=20)
        draw.text((120, 120), "NeatDrop / 人工构造样例", font=font, fill="#355b3e")
        draw.text((120, 220), "课程复习 · 线性代数", font=font, fill="#526744")
        draw.text((120, 290), "矩阵 · 特征值 · 线性变换", font=small, fill="#839572")
        draw.text((120, 430), "仅供功能演示，不包含真实用户资料。", font=small, fill="#9ca58e")
        with image_path.open("xb") as out:
            image.save(out, format="PNG")
    (ROOT / "nested-folder").mkdir(exist_ok=True)
    receipt = ROOT / 'offline_invoice_demo.png'
    if not receipt.exists():
        image = Image.new('RGB', (1000, 640), 'white')
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 38) if Path('C:/Windows/Fonts/msyh.ttc').exists() else ImageFont.load_default(size=38)
        for index, line in enumerate(['增值税电子普通发票（人工样例）', '发票号码 123456789', '购买方 样例公司', '销售方 样例文具商户', '价税合计 38.50元', '仅供离线OCR测试，不是有效票据']):
            draw.text((40, 30 + index * 95), line, fill='#252c20', font=font)
        with receipt.open('xb') as out:
            image.save(out, format='PNG')
    print(str(ROOT))


if __name__ == "__main__":
    create_demo()
