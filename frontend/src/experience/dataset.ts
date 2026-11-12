/** Author-created CC0-1.0 material. No personal files or external downloads. */
export interface ExperienceFile { id: string; name: string; text?: string; image?: string; prerecorded?: boolean }
export const EXPERIENCE_PATH = '网页体验 / 学习资料'
export const IMPORT_PATH = '网页体验 / 自选文本'
export const experienceFiles: ExperienceFile[] = [
  { id: 'notes-optics', name: '光学课程笔记.md', text: '光学课程学习笔记\n定义：凸透镜成像由物距像距与焦距决定。定理：光路可逆。推导：薄透镜公式将物距像距相加倒数，得到焦距倒数。例题：测量光学透镜焦距，调整光源位置。复习时注意凸透镜成像与测量误差。' },
  { id: 'experiment-optics', name: '透镜测量实验记录.txt', text: '光学实验记录\n实验目的：测量凸透镜焦距，比较物距像距的变化。实验器材：光学平台、凸透镜、光源和刻度尺。实验步骤：改变光源位置，每隔十厘米记录物距像距；保持成像清楚，重复测量五次。实验结果：凸透镜焦距均值为12.4厘米，测量误差0.2厘米。' },
  { id: 'paper-optics', name: '透镜成像研究摘要.md', text: '光学透镜研究论文\n摘要：研究凸透镜焦距测量中物距像距误差的传播。研究方法：在光学平台改变光源位置，采集成像观测。结果：多次测量降低焦距误差。结论：固定光源位置能够稳定凸透镜成像。参考文献：本示例为人工合成研究叙述，不对应真实论文。' },
  { id: 'data-matrix', name: '矩阵研究数据说明.md', text: '科研测量数据说明\n研究课题：线性映射下矩阵特征值的变化。变量定义：矩阵秩、基向量数量与特征值。观测数据：对三阶矩阵进行重复测量，记录阶梯矩阵的主元位置。采集日期：2026年11月，样本编号：M01至M20。数据单位：无量纲。本例为人工合成，不对应真实实验。' },
  { id: 'courseware-matrix', name: '矩阵课程课件摘录.txt', text: '线性代数课程课件\n第三讲：矩阵与线性映射。学习目标：理解矩阵秩与基向量。教学安排：两学时讲授、课堂讨论和例题。章节一：线性映射定义。章节二：矩阵特征值。章节三：定理证明及习题。' },
  { id: 'exam-matrix', name: '矩阵练习题.txt', text: '线性代数练习题\n一、选择题，每题五分：矩阵的秩与线性无关向量个数有什么关系？二、证明题：证明线性映射保持向量加法。三、解答题：计算矩阵特征值。参考答案与解析：使用初等变换计算矩阵的阶梯形式。' },
  { id: 'reading-literature', name: '阅读摘录.md', text: '读书摘录\n书名：虚构的阅读方法手册。作者：NeatDrop 示例作者。章节：第二章。页码：24。摘录原文：阅读一段材料时，应先分辨作者提出的问题和支持论据。阅读心得：整理来源与自己的理解，避免把摘抄当作原创观点。' },
  { id: 'technical-guide', name: '数据接口学习手册.md', text: '接口文档\n技术主题：课程测量数据的只读接口。请求参数：sample_id 为样本编号，unit 为数据单位。返回值：温度测量值、采集日期和设备状态。错误码：404 表示没有样本。调用示例：在本地读取测试数据，不连接任何服务。' },
]
