# Photo to Scan (MCP)

手机拍的纸页照片 → 平直扫描件：自动转正（0/90/180/270）、纠偏、去阴影与黑边、裁成
A4 比例，输出 JPG/PNG 或多页 PDF，红章与手写保留。

```
npx tsx photo-scan/index.ts
```

## 工具

| 工具 | 干什么 |
| --- | --- |
| `photo_to_scan` | 主入口。单文件或整个目录 → 扫描图（`--mode color/gray/bw`，可合并成 PDF） |
| `photo_to_scan_preview` | 只判方向不出图，给一张 2×2 四向候选对照图（右上格 = auto 的判断） |
| `photo_to_scan_doctor` | 自检 Python、依赖、加速件，以及 vendor 引擎与 skill 版是否同源 |

## 设计：为什么这里没有一行图像代码

所有处理都在 `vendor/photo_to_scan.py`，与
[`zhaowen-skill/photo-to-scan`](https://github.com/zhuobichen/zhaowen-skill/tree/main/photo-to-scan)
同一个文件。同一套算法在 skill 和 MCP 各写一遍，迟早只修一边 —— 这类项目里
"浓墨手写块被当成背景洗白""1px 表格线被去噪吃掉"都是修一次只修一个通道就会复发
的坑。所以：**一个 Python 入口，两条通道**，MCP 只负责协议、参数和白话回执。

改算法就改 skill 那份，然后：

```bash
cp ../zhaowen-skill/photo-to-scan/scripts/photo_to_scan.py vendor/photo_to_scan.py
```

`photo_to_scan_doctor` 会比对两边 md5，漂移了会直接说。

## 依赖

Python 侧（必需）：`numpy scipy pillow`；可选加速件 `opencv-python-headless`
（四角透视 + 凸包蒙版）、`rapidocr-onnxruntime`（判 90/270）、`pymupdf`（多页 PDF）。

```bash
python -m pip install numpy scipy pillow opencv-python-headless rapidocr-onnxruntime pymupdf
npm install
```

解释器默认 `python`（Windows）/ `python3`，可用 `PHOTO_SCAN_PYTHON` 指定；
单次调用上限 600 s，可用 `PHOTO_SCAN_TIMEOUT_MS` 调整。

## 已知边界

- **弯曲纸面**（书脊、揉皱的纸）只纠偏不展平 —— 那一步要 UVDoc/DocTr++ 这类模型，
  本项目没接。
- 方向判定不是 `high` 时会显式警告：判错的表现是"整页倒置"，而图看着仍然干净，
  很容易被当成成功交付。看到警告就先看图，用 `orient` 覆盖。
- 相机把纸角切掉时，那一角会剩一条细黑影；`--no-mask` 可以保留原样而不是猜。
