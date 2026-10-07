const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 解决中文文件名乱码问题
function decodeFilename(name) {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch (err) {
    return name;
  }
}

// 避免文件名冲突，如果已存在自动重命名为 xxx (1).ext
function getSafeUniqueName(dir, originalName) {
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  let finalName = originalName;
  let counter = 1;

  while (fs.existsSync(path.join(dir, finalName))) {
    finalName = `${baseName} (${counter})${ext}`;
    counter++;
  }
  return finalName;
}

// 配置 Multer 存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const rawName = decodeFilename(file.originalname);
    // 过滤掉危险字符，只保留安全的文件名
    const safeBase = path.basename(rawName);
    const uniqueName = getSafeUniqueName(UPLOAD_DIR, safeBase);
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// 静态资源托管（前端页面）
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 获取所有文件列表
app.get('/api/files', async (req, res) => {
  try {
    const files = await fs.promises.readdir(UPLOAD_DIR);
    const fileList = await Promise.all(
      files.map(async (filename) => {
        const filePath = path.join(UPLOAD_DIR, filename);
        try {
          const stat = await fs.promises.stat(filePath);
          return {
            name: filename,
            size: stat.size,
            mtime: stat.mtimeMs,
            isFile: stat.isFile()
          };
        } catch {
          return null;
        }
      })
    );

    // 过滤非文件并按最新修改时间降序排序
    const validFiles = fileList
      .filter((item) => item && item.isFile)
      .sort((a, b) => b.mtime - a.mtime);

    res.json({ success: true, files: validFiles });
  } catch (error) {
    console.error('获取文件列表失败:', error);
    res.status(500).json({ success: false, message: '获取文件列表失败' });
  }
});

// 多文件上传接口
app.post('/api/upload', upload.array('files'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: '未接收到任何文件' });
  }
  const uploadedFiles = req.files.map(f => f.filename);
  res.json({
    success: true,
    message: `成功上传 ${uploadedFiles.length} 个文件`,
    files: uploadedFiles
  });
});

// 下载文件接口
app.get('/api/download/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('文件不存在或已被删除');
  }

  // 触发浏览器以附件形式下载，支持中文文件名
  res.download(filePath, safeFilename, (err) => {
    if (err && !res.headersSent) {
      console.error('下载出错:', err);
      res.status(500).send('下载文件时发生错误');
    }
  });
});

// 删除文件接口
app.delete('/api/files/:filename', async (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, safeFilename);

  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在' });
    }
    await fs.promises.unlink(filePath);
    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('删除文件失败:', error);
    res.status(500).json({ success: false, message: '删除文件失败' });
  }
});

// 获取局域网 IP 信息接口（方便前端展示和扫码）
app.get('/api/info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // 跳过内部回环地址和非 IPv4
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  res.json({
    port: PORT,
    ips: addresses
  });
});

// 启动服务
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n==================================================');
  console.log('🎉 局域网文件共享服务已启动！');
  console.log(`- 本机访问:   http://localhost:${PORT}`);

  const interfaces = os.networkInterfaces();
  let foundLAN = false;
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`- 局域网访问: http://${net.address}:${PORT}`);
        foundLAN = true;
      }
    }
  }

  if (!foundLAN) {
    console.log('- 提示: 未检测到局域网网络接口，可能未连接网络');
  }
  console.log('==================================================\n');
});
