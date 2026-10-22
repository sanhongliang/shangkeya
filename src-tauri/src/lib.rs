// 上课鸭 桌面端：PPT → PDF 转换（WPS/Office COM → LibreOffice 兜底）
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

/// 探测结果：前端设置页/课堂页展示可用转换器
#[tauri::command]
fn detect_ppt_converters() -> serde_json::Value {
    let soffice = find_soffice();
    serde_json::json!({
        "wps": com_progid_available("KWPP.Application") || com_progid_available("WPP.Application"),
        "office": com_progid_available("PowerPoint.Application"),
        "libreoffice": soffice.is_some(),
        "libreofficePath": soffice.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
    })
}

/// 把 PPT 转换为 PDF，返回 PDF 字节
#[tauri::command]
fn convert_ppt_to_pdf(src: String) -> Result<Vec<u8>, String> {
    let out = convert_ppt(src.as_str()).map_err(|e| format!("PPT 转换失败: {e}"))?;
    std::fs::read(&out).map_err(|e| format!("读取转换结果失败: {e}"))
}

/// 主转换流程：COM（WPS/Office）→ LibreOffice 兜底
fn convert_ppt(src: &str) -> Result<PathBuf, String> {
    let src_path = Path::new(src);
    if !src_path.exists() {
        return Err(format!("文件不存在: {src}"));
    }
    let ext = src_path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !["ppt", "pptx"].contains(&ext.as_str()) {
        return Err(format!("不支持的文件类型: .{ext}（仅支持 ppt/pptx）"));
    }
    let stem = src_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ppt".into());
    let out = std::env::temp_dir().join(format!("shangkeya_{}_{}.pdf", stem, std::process::id()));

    // ① WPS 演示 COM
    for progid in ["KWPP.Application", "WPP.Application"] {
        if com_progid_available(progid) {
            let r = convert_via_com(progid, src, out.as_path());
            if r.is_ok() && out.exists() && out.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                return Ok(out);
            }
            let _ = std::fs::remove_file(&out);
        }
    }
    // ② MS Office PowerPoint COM
    if com_progid_available("PowerPoint.Application") {
        let r = convert_via_com("PowerPoint.Application", src, out.as_path());
        if r.is_ok() && out.exists() && out.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            return Ok(out);
        }
        let _ = std::fs::remove_file(&out);
    }
    // ③ LibreOffice 兜底
    if let Some(soffice) = find_soffice() {
        let r = convert_via_soffice(soffice.as_path(), src, out.as_path());
        if r.is_ok() && out.exists() {
            return Ok(out);
        }
        let _ = std::fs::remove_file(&out);
    }
    Err("未找到可用的 PPT 转换器（请安装 WPS/Office，或使用 LibreOffice）".into())
}

/// 通过 PowerShell COM 调用 WPS/Office 另存为 PDF（带超时保护）
fn convert_via_com(progid: &str, src: &str, out: &Path) -> Result<(), String> {
    // 安全：路径经环境变量传递，避免命令注入
    // Visible 赋值对 WPS 可能抛 E_FAIL（KWPP 不支持），容错忽略；
    // Open/SaveAs/Export 双保存方式兼容 WPS 与 MS Office。
    let script = r#"
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject $env:SKY_PROGID
$doc = $null
try {
  try { $app.Visible = $false } catch {}
  $doc = $app.Presentations.Open($env:SKY_SRC, $true, $false, $false)
  try { $doc.SaveAs($env:SKY_OUT, 32) }
  catch { $doc.ExportAsFixedFormat($env:SKY_OUT, 2) }
  $doc.Close()
  $app.Quit()
  exit 0
} catch {
  try { if ($doc) { $doc.Close() } } catch {}
  try { $app.Quit() } catch {}
  exit 1
}
"#;
    let mut cmd = Command::new("powershell");
    cmd.arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(script)
        .env("SKY_PROGID", progid)
        .env("SKY_SRC", src)
        .env("SKY_OUT", out.to_string_lossy().into_owned())
        .env("SKY_TMP", std::env::temp_dir().to_string_lossy().into_owned());
    let ok = run_with_timeout(&mut cmd, 90).map_err(|e| format!("COM 转换失败（{progid}）: {e}"))?;
    if ok {
        Ok(())
    } else {
        Err(format!("COM 转换失败（{progid}）"))
    }
}

/// 通过 LibreOffice headless 转换（带超时保护）
fn convert_via_soffice(soffice: &Path, src: &str, out: &Path) -> Result<(), String> {
    let outdir = out.parent().unwrap_or_else(|| Path::new("."));
    let mut cmd = Command::new(soffice);
    cmd.arg("--headless")
        .arg("--norestore")
        .arg("--invisible")
        .arg("--convert-to")
        .arg("pdf")
        .arg("--outdir")
        .arg(outdir)
        .arg(src);
    let ok = run_with_timeout(&mut cmd, 120)
        .map_err(|e| format!("无法启动 LibreOffice: {e}"))?;
    if !ok {
        return Err("LibreOffice 转换失败".into());
    }
    // soffice 输出为 <源名>.pdf，重命名为期望路径
    let src_path = Path::new(src);
    let produced = outdir.join(format!(
        "{}.pdf",
        src_path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "ppt".into())
    ));
    if produced.exists() && produced != out {
        std::fs::copy(&produced, out)
            .map_err(|e| format!("重命名转换结果失败: {e}"))?;
        let _ = std::fs::remove_file(&produced);
    }
    Ok(())
}

/// 运行子进程并在超时后强制结束；返回进程是否成功退出（exit 0）
fn run_with_timeout(cmd: &mut Command, secs: u64) -> Result<bool, String> {
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("启动失败: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(secs);
    loop {
        match child.try_wait().map_err(|e| format!("等待进程失败: {e}"))? {
            Some(status) => return Ok(status.success()),
            None => {
                if Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("转换超时（>{secs}s）"));
                }
                thread::sleep(Duration::from_millis(300));
            }
        }
    }
}

/// 探测 COM ProgID 是否已注册
fn com_progid_available(progid: &str) -> bool {
    for root in ["HKLM:\\SOFTWARE\\Classes", "HKCU:\\SOFTWARE\\Classes"] {
        let test = format!("{}\\{}", root, progid);
        let status = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!("Test-Path '{test}'"),
            ])
            .output();
        if let Ok(o) = status {
            if String::from_utf8_lossy(&o.stdout).trim() == "True" {
                return true;
            }
        }
    }
    // 兼容：直接尝试创建 COM 对象
    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!(
                "try {{ $null = New-Object -ComObject {progid}; 'True' }} catch {{ 'False' }}"
            ),
        ])
        .output();
    if let Ok(o) = status {
        if String::from_utf8_lossy(&o.stdout).trim() == "True" {
            return true;
        }
    }
    false
}

/// 探测 LibreOffice 可执行文件（打包兜底目录 → 常见安装路径 → PATH）
fn find_soffice() -> Option<PathBuf> {
    // 1. EXE 同级 libreoffice/（打包兜底）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("libreoffice").join("program").join("soffice.exe");
            if p.exists() {
                return Some(p);
            }
        }
    }
    // 2. 常见安装路径
    for p in [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        r"C:\Program Files\LibreOffice\program\soffice.com",
    ] {
        let path = PathBuf::from(p);
        if path.exists() {
            return Some(path);
        }
    }
    // 3. PATH
    let status = Command::new("where").arg("soffice").output().ok()?;
    if status.status.success() {
        let first = String::from_utf8_lossy(&status.stdout)
            .lines()
            .next()?
            .trim()
            .to_string();
        if !first.is_empty() {
            return Some(PathBuf::from(first));
        }
    }
    None
}

/// 本机课件目录树节点
#[derive(serde::Serialize)]
struct CwNode {
    name: String,
    path: String,
    kind: String, // folder | tiff | tif | pdf | png | jpg | jpeg
    children: Option<Vec<CwNode>>,
}

/// 扫描本机课件根目录（D:\新版课件\高中物理，对应 版本/年级/学期/章节 层级）
#[tauri::command]
fn scan_courseware_tree() -> Result<Vec<CwNode>, String> {
    let root = r"D:\新版课件\高中物理";
    if !Path::new(root).exists() {
        return Ok(vec![]);
    }
    scan_courseware_dir(root, 0)
}

fn scan_courseware_dir(dir: &str, depth: usize) -> Result<Vec<CwNode>, String> {
    if depth > 10 {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in std::fs::read_dir(dir).map_err(|e| format!("读取目录 {dir} 失败: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            let children = scan_courseware_dir(path.to_string_lossy().as_ref(), depth + 1)?;
            out.push(CwNode {
                name,
                path: path.to_string_lossy().into_owned(),
                kind: "folder".into(),
                children: Some(children),
            });
        } else {
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if matches!(ext.as_str(), "tiff" | "tif" | "pdf" | "png" | "jpg" | "jpeg" | "html" | "htm") {
                out.push(CwNode {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    kind: ext,
                    children: None,
                });
            }
        }
    }
    // 目录在前、名称排序
    out.sort_by(|a, b| {
        let ak = if a.kind == "folder" { 0 } else { 1 };
        let bk = if b.kind == "folder" { 0 } else { 1 };
        ak.cmp(&bk).then(a.name.cmp(&b.name))
    });
    Ok(out)
}

/// 读取本机课件文件字节（TIFF/PDF/图片 → 前端解码渲染）
#[tauri::command]
fn read_courseware_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("读取文件失败: {e}"))
}

/// —— 目录导入：选择本地课件根目录 → 验证（子孙含 ppt/pdf/tiff 且 tiff 尺寸满足）→ 生成 版本/年级/学期 树 ——
#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ImportedNode {
    name: String,
    kind: String,
    path: String,
    children: Option<Vec<ImportedNode>>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ImportedSemester {
    semester: String,
    nodes: Vec<ImportedNode>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ImportedGrade {
    grade: String,
    semesters: Vec<ImportedSemester>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ImportedVersion {
    version: String,
    grades: Vec<ImportedGrade>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ImportResult {
    ok: bool,
    message: String,
    versions: Vec<ImportedVersion>,
}

/// 目录导入缓存：扫描结果存 %APPDATA%\shangkeya\import-cache\<dir-key>.json；
/// 下次导入同一目录时，若顶层签名未变则直接读缓存返回（避免大目录重复全量扫描）
fn import_cache_file(dir: &str) -> std::path::PathBuf {
    let key: String = dir
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    std::path::Path::new(&base)
        .join("shangkeya")
        .join("import-cache")
        .join(format!("{}.json", key))
}

/// 删除指定目录的导入缓存文件（删除课件目录时同步清理扫描记录）
#[tauri::command]
fn remove_import_cache(dir: String) -> Result<(), String> {
    let file = import_cache_file(&dir);
    match std::fs::remove_file(&file) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除课件目录缓存失败: {}", e)),
    }
}

/// 顶层签名：根目录直接子项（名称 + 是否目录），排序后比较——
/// 目录结构变更（增删版本/年级/学期层）即失效；深层课件文件增删不改变签名（缓存仍可用）
fn dir_top_signature(dir: &str) -> Vec<String> {
    let mut v = vec![];
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            v.push(format!("{}{}", if is_dir { 'D' } else { 'F' }, name));
        }
    }
    v.sort();
    v
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ImportCache {
    dir: String,
    sig: Vec<String>,
    result: ImportResult,
}

fn read_import_cache(file: &std::path::Path, dir: &str) -> Option<ImportResult> {
    let text = std::fs::read_to_string(file).ok()?;
    let cache: ImportCache = serde_json::from_str(&text).ok()?;
    if cache.dir != dir {
        return None;
    }
    if cache.sig != dir_top_signature(dir) {
        return None;
    }
    Some(cache.result)
}

fn write_import_cache(file: &std::path::Path, dir: &str, result: &ImportResult) {
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let cache = ImportCache {
        dir: dir.to_string(),
        sig: dir_top_signature(dir),
        result: result.clone(),
    };
    if let Ok(text) = serde_json::to_string(&cache) {
        let _ = std::fs::write(file, text);
    }
}

/// 导入并验证课件目录：第一层版本 → 第二层年级 → 第三层学期（含章节/课件文件）
#[tauri::command]
fn import_courseware_dir(dir: String) -> Result<ImportResult, String> {
    let root = Path::new(&dir);
    if !root.is_dir() {
        return Ok(ImportResult {
            ok: false,
            message: format!("目录不存在: {dir}"),
            versions: vec![],
        });
    }
    // 缓存命中：目录顶层结构未变 → 直接返回上次扫描结果（不重复全量扫描）
    let cache_file = import_cache_file(&dir);
    if let Some(cached) = read_import_cache(&cache_file, &dir) {
        return Ok(cached);
    }
    let mut versions: Vec<ImportedVersion> = vec![];

    for ver in read_dirs(root) {
        let mut grades: Vec<ImportedGrade> = vec![];
        for grd in read_dirs(&ver) {
            let mut semesters: Vec<ImportedSemester> = vec![];
            for sem in read_dirs(&grd) {
                let mut nodes = vec![];
                scan_import_nodes(&sem, 0, &mut nodes);
                semesters.push(ImportedSemester {
                    semester: file_name(&sem),
                    nodes,
                });
            }
            grades.push(ImportedGrade {
                grade: file_name(&grd),
                semesters,
            });
        }
        versions.push(ImportedVersion {
            version: file_name(&ver),
            grades,
        });
    }

    // 不做课件验证（用户已确认「选择文件夹不做验证」），仅返回目录结构
    let result = ImportResult {
        ok: true,
        message: format!("目录已保存：{dir}"),
        versions,
    };
    // 扫描结果写入缓存文件：下次同一目录直接读取，无需重新扫描
    write_import_cache(&cache_file, &dir, &result);
    Ok(result)
}

/// 递归扫描学期目录下的章节/课件文件（只收集目录结构与课件文件，不做验证）
fn scan_import_nodes(
    dir: &std::path::Path,
    depth: usize,
    out: &mut Vec<ImportedNode>,
) {
    if depth > 12 {
        return;
    }
    for entry in std::fs::read_dir(dir).map_err(|_| ()).ok().into_iter().flatten() {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            let mut children = vec![];
            scan_import_nodes(&path, depth + 1, &mut children);
            if !children.is_empty() {
                out.push(ImportedNode {
                    name,
                    kind: "folder".into(),
                    path: String::new(),
                    children: Some(children),
                });
            }
        } else {
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if matches!(ext.as_str(), "ppt" | "pptx" | "pdf" | "tiff" | "tif" | "png" | "jpg" | "jpeg" | "html" | "htm") {
                out.push(ImportedNode {
                    name,
                    kind: ext,
                    path: path.to_string_lossy().into_owned(),
                    children: None,
                });
            }
        }
    }
    // 目录在前
    out.sort_by(|a, b| {
        let ak = if a.children.is_some() { 0 } else { 1 };
        let bk = if b.children.is_some() { 0 } else { 1 };
        ak.cmp(&bk).then(a.name.cmp(&b.name))
    });
}

fn read_dirs(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

fn file_name(p: &std::path::Path) -> String {
    p.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 尺寸规则：讲解页 878x494、问题页 878x600（高>494）、答案页宽<878
#[cfg(test)]
fn tiff_sizes_valid(sizes: &[(u32, u32)]) -> bool {
    if sizes.is_empty() {
        return false;
    }
    let mut has_wide = false;
    for &(w, _h) in sizes.iter() {
        if w == 878 {
            has_wide = true;
        }
        if w > 878 {
            return false;
        }
    }
    has_wide
}

/// 解析多页 TIFF 各页尺寸（宽/高），仅按 IFD 偏移 seek 精确读取，不做整文件解码
#[cfg(test)]
fn tiff_page_sizes(path: &std::path::Path) -> Option<Vec<(u32, u32)>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let mut head = [0u8; 8];
    file.read_exact(&mut head).ok()?;
    let le = match (head[0], head[1]) {
        (0x49, 0x49) => true,
        (0x4D, 0x4D) => false,
        _ => return None,
    };
    let mut off = rd_u32(&head, 4, le) as u64;
    let mut sizes = vec![];
    let mut seen = std::collections::HashSet::new();
    while off > 0 && off < 16 * 1024 * 1024 && !seen.contains(&off) {
        seen.insert(off);
        file.seek(SeekFrom::Start(off)).ok()?;
        let mut cnt_buf = [0u8; 2];
        file.read_exact(&mut cnt_buf).ok()?;
        let cnt = rd_u16(&cnt_buf, 0, le) as usize;
        let mut entries = vec![0u8; cnt * 12 + 4];
        file.read_exact(&mut entries).ok()?;
        let mut w = 0u32;
        let mut h = 0u32;
        for i in 0..cnt {
            let e = i * 12;
            match rd_u16(&entries, e, le) {
                256 => w = rd_u32(&entries, e + 8, le),
                257 => h = rd_u32(&entries, e + 8, le),
                _ => {}
            }
        }
        sizes.push((w, h));
        off = rd_u32(&entries, cnt * 12, le) as u64;
    }
    Some(sizes)
}

#[cfg(test)]
fn rd_u16(d: &[u8], o: usize, le: bool) -> u16 {
    if le {
        u16::from_le_bytes([d[o], d[o + 1]])
    } else {
        u16::from_be_bytes([d[o], d[o + 1]])
    }
}

#[cfg(test)]
fn rd_u32(d: &[u8], o: usize, le: bool) -> u32 {
    if le {
        u32::from_le_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
    } else {
        u32::from_be_bytes([d[o], d[o + 1], d[o + 2], d[o + 3]])
    }
}

/// 识别多页 TIFF 第一页（首页）的文字，用于检测封面页（如带「掌门」水印的页）并跳过。
/// 基于 Windows 自带 OCR（WinRT Windows.Media.Ocr，中文系统默认支持简体中文）。
/// 为提高艺术字/大号文字的识别率，依次尝试：原图 → 3×放大灰度 → 3×放大灰度+二值化。
/// 任何失败（OCR 不可用 / 文件损坏 / 无语言包）返回 Err，前端据此选择不跳过（安全回退）。
#[tauri::command]
fn tiff_first_frame_text(path: String) -> Result<String, String> {
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::{StorageFile, Streams::RandomAccessStreamReference};

    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_str()))
        .map_err(|e| format!("打开文件失败: {e}"))?
        .get()
        .map_err(|e| format!("打开文件失败: {e}"))?;
    let stream = RandomAccessStreamReference::CreateFromFile(&file)
        .map_err(|e| format!("创建流失败: {e}"))?;
    let rstream = stream
        .OpenReadAsync()
        .map_err(|e| format!("打开流失败: {e}"))?
        .get()
        .map_err(|e| format!("打开流失败: {e}"))?;
    let decoder = BitmapDecoder::CreateAsync(&rstream)
        .map_err(|e| format!("解码图片失败: {e}"))?
        .get()
        .map_err(|e| format!("解码图片失败: {e}"))?;
    // 多页 TIFF 默认取第一帧（首页）；统一转为 BGRA8 以便像素处理
    let raw = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| format!("取位图失败: {e}"))?
        .get()
        .map_err(|e| format!("取位图失败: {e}"))?;
    let bmp = if raw.BitmapPixelFormat().map_err(|e| format!("读格式失败: {e}"))? == BitmapPixelFormat::Bgra8 {
        raw
    } else {
        SoftwareBitmap::Convert(&raw, BitmapPixelFormat::Bgra8)
            .map_err(|e| format!("转换位图失败: {e}"))?
    };

    let ocr = |b: &SoftwareBitmap| -> Result<String, String> {
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()
            .map_err(|e| format!("创建 OCR 引擎失败: {e}"))?;
        let result = engine
            .RecognizeAsync(b)
            .map_err(|e| format!("识别失败: {e}"))?
            .get()
            .map_err(|e| format!("识别失败: {e}"))?;
        Ok(result.Text().map_err(|e| format!("读取识别结果失败: {e}"))?.to_string())
    };

    // ① 原图直接识别
    if let Ok(txt) = ocr(&bmp) {
        if !txt.trim().is_empty() {
            return Ok(txt);
        }
    }
    // ② 放大 3 倍 + 灰度（艺术字/发光字更易识别）
    let w = bmp.PixelWidth().map_err(|e| format!("读宽失败: {e}"))? as u32;
    let h = bmp.PixelHeight().map_err(|e| format!("读高失败: {e}"))? as u32;
    if let Ok(pixels) = bitmap_pixels(&bmp) {
        let (big, ew, eh) = enlarge_gray(&pixels, w, h, 3);
        if let Ok(big_bmp) = make_bgra_bitmap(&big, ew, eh) {
            if let Ok(txt) = ocr(&big_bmp) {
                if !txt.trim().is_empty() {
                    return Ok(txt);
                }
            }
            // ③ 二值化（强对比：亮字→白、暗底→黑）
            let bin = threshold_bw(&big);
            if let Ok(bin_bmp) = make_bgra_bitmap(&bin, ew, eh) {
                if let Ok(txt) = ocr(&bin_bmp) {
                    if !txt.trim().is_empty() {
                        return Ok(txt);
                    }
                }
            }
            // ④ 反色二值化（发光/浅色字在深底：亮字→黑字白底）
            let inv = threshold_bw_invert(&big);
            if let Ok(inv_bmp) = make_bgra_bitmap(&inv, ew, eh) {
                if let Ok(txt) = ocr(&inv_bmp) {
                    if !txt.trim().is_empty() {
                        return Ok(txt);
                    }
                }
            }
        }
    }
    Ok(String::new())
}

/// 读取 SoftwareBitmap 的 BGRA8 像素
fn bitmap_pixels(bitmap: &windows::Graphics::Imaging::SoftwareBitmap) -> Result<Vec<u8>, String> {
    use windows::core::Interface;
    use windows::Graphics::Imaging::BitmapBufferAccessMode;
    use windows::Win32::System::WinRT::IMemoryBufferByteAccess;

    let buffer = bitmap
        .LockBuffer(BitmapBufferAccessMode::Read)
        .map_err(|e| format!("锁定位图失败: {e}"))?;
    let reference = buffer.CreateReference().map_err(|e| format!("创建引用失败: {e}"))?;
    let access: IMemoryBufferByteAccess = reference.cast().map_err(|e| format!("转换失败: {e}"))?;
    let mut cap: u32 = 0;
    let mut ptr: *mut u8 = std::ptr::null_mut();
    unsafe {
        access.GetBuffer(&mut ptr, &mut cap).map_err(|e| format!("取缓冲区失败: {e}"))?;
    }
    let slice = unsafe { std::slice::from_raw_parts(ptr, cap as usize) };
    Ok(slice.to_vec())
}

/// 由 BGRA8 像素构造 SoftwareBitmap
fn make_bgra_bitmap(
    pixels: &[u8],
    w: u32,
    h: u32,
) -> Result<windows::Graphics::Imaging::SoftwareBitmap, String> {
    use windows::core::Interface;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Storage::Streams::Buffer;
    use windows::Win32::System::WinRT::IBufferByteAccess;

    let buffer = Buffer::Create(pixels.len() as u32).map_err(|e| format!("创建缓冲区失败: {e}"))?;
    {
        let access: IBufferByteAccess = buffer.cast().map_err(|e| format!("转换失败: {e}"))?;
        let ptr = unsafe { access.Buffer().map_err(|e| format!("取缓冲区失败: {e}"))? };
        let slice = unsafe { std::slice::from_raw_parts_mut(ptr, pixels.len()) };
        slice.copy_from_slice(pixels);
    }
    SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w as i32, h as i32)
        .map_err(|e| format!("创建位图失败: {e}"))
}

/// 最近邻放大 + 灰度（输出 BGRA8，RGB 相同）
fn enlarge_gray(px: &[u8], w: u32, h: u32, s: u32) -> (Vec<u8>, u32, u32) {
    let ew = w * s;
    let eh = h * s;
    let mut out = vec![0u8; (ew as usize) * (eh as usize) * 4];
    for y in 0..eh {
        for x in 0..ew {
            let sx = x / s;
            let sy = y / s;
            let i = ((sy * w + sx) * 4) as usize;
            let gray = ((px[i] as u32 * 299 + px[i + 1] as u32 * 587 + px[i + 2] as u32 * 114) / 1000) as u8;
            let o = ((y * ew + x) * 4) as usize;
            out[o] = gray;
            out[o + 1] = gray;
            out[o + 2] = gray;
            out[o + 3] = 255;
        }
    }
    (out, ew, eh)
}

/// 二值化：>128 置白，否则置黑
fn threshold_bw(px: &[u8]) -> Vec<u8> {
    let mut out = px.to_vec();
    for c in out.chunks_exact_mut(4) {
        let v = if c[0] > 128 { 255 } else { 0 };
        c[0] = v;
        c[1] = v;
        c[2] = v;
        c[3] = 255;
    }
    out
}

/// 反色二值化：>128 置黑，否则置白（发光/浅色字在深底 → 黑字白底）
fn threshold_bw_invert(px: &[u8]) -> Vec<u8> {
    let mut out = px.to_vec();
    for c in out.chunks_exact_mut(4) {
        let v = if c[0] > 128 { 0 } else { 255 };
        c[0] = v;
        c[1] = v;
        c[2] = v;
        c[3] = 255;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiff_sample_first_frame_text() {
        // 遍历多个样本，打印首页识别文字（用于人工核对「掌门」水印是否命中；OCR 不可用则打印错误）
        let samples = [
            r"C:\Users\Administrator\AppData\Local\Temp\zm1.png",
            r"C:\Users\Administrator\AppData\Local\Temp\zm2.png",
            r"D:\新版课件\初中物理\1通用版\1初二\1_暑假\1_预习\1_机械运动\1_长度和时间的测量\长度和时间的测量.tiff",
        ];
        for p in samples {
            if !Path::new(p).exists() {
                println!("样本不存在，跳过: {p}");
                continue;
            }
            match tiff_first_frame_text(p.into()) {
                Ok(txt) => println!("[{}] 首页文字: {}", Path::new(p).file_stem().unwrap_or_default().to_string_lossy(), txt),
                Err(e) => println!("[{}] OCR 不可用: {e}", Path::new(p).file_stem().unwrap_or_default().to_string_lossy()),
            }
        }
    }

    #[test]
    fn tiff_sample_sizes_valid() {
        let p = Path::new(
            r"D:\新版课件\高中物理\1通用版\1高一\1_暑期\1_衔接\1_数学要求及复习\1_力与运动的复习\力与运动的复习.tiff",
        );
        let sizes = tiff_page_sizes(p).expect("样本 TIFF 应可解析");
        assert!(!sizes.is_empty(), "应解析出页尺寸");
        assert!(tiff_sizes_valid(&sizes), "样本应满足尺寸规则");
        assert_eq!(sizes.first(), Some(&(878, 494)), "第一页应为讲解页 878x494");
        // 样本应包含 878 宽问题页与 <878 答案页
        assert!(sizes.iter().any(|&(w, _)| w == 878 && w > 0));
        assert!(sizes.iter().any(|&(w, _)| w < 878), "应存在答案页（宽<878）");
    }

    #[test]
    fn import_sample_dir_structure() {
        // 真实课件根目录遍历：版本 → 年级 → 学期 → 章节（递归） → 文件
        let res = import_courseware_dir(r"D:\新版课件\高中物理".into()).expect("导入应成功");
        assert!(
            res.versions.iter().any(|v| v.version == "1通用版"),
            "第一层应遍历出版本「1通用版」，实际: {}",
            res.versions.iter().map(|v| v.version.clone()).collect::<Vec<_>>().join(",")
        );
        let ver = res
            .versions
            .iter()
            .find(|v| v.version == "1通用版")
            .expect("1通用版");
        assert!(
            ver.grades.iter().any(|g| g.grade == "1高一"),
            "第二层应遍历出年级「1高一」"
        );
        let grd = ver.grades.iter().find(|g| g.grade == "1高一").expect("1高一");
        assert!(
            grd.semesters.iter().any(|s| s.semester == "1_暑期"),
            "第三层应遍历出学期「1_暑期」, 实际: {}",
            grd.semesters.iter().map(|s| s.semester.clone()).collect::<Vec<_>>().join(",")
        );
        let sem = grd
            .semesters
            .iter()
            .find(|s| s.semester == "1_暑期")
            .expect("1_暑期");
        // 章节文件夹应排最前（目录在前）
        let names: Vec<&str> = sem.nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names[0], "1_衔接", "章节文件夹应排最前，实际: {names:?}");
        // 递归检查节点树中应能找到「力与运动的复习」文件夹与 TIFF 文件
        fn find_name(nodes: &[ImportedNode], target: &str) -> bool {
            nodes.iter().any(|n| {
                n.name.contains(target)
                    || n.children
                        .as_ref()
                        .is_some_and(|c| find_name(c, target))
            })
        }
        assert!(find_name(&sem.nodes, "力与运动的复习"), "节点树应含「力与运动的复习」");
        // TIFF 文件节点应带真实文件路径（供课堂页加载）
        fn find_tiff_path(nodes: &[ImportedNode]) -> Option<String> {
            for n in nodes {
                if n.kind == "tiff" && !n.path.is_empty() {
                    return Some(n.path.clone());
                }
                if let Some(c) = &n.children {
                    if let Some(p) = find_tiff_path(c) {
                        return Some(p);
                    }
                }
            }
            None
        }
        let p = find_tiff_path(&sem.nodes).expect("应找到 TIFF 文件节点");
        assert!(p.contains("力与运动的复习"), "TIFF 路径应指向样本: {p}");
    }
}

/// 取窗口的 Win32 HWND
fn window_hwnd(win: &tauri::WebviewWindow) -> Option<windows::Win32::Foundation::HWND> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let Ok(handle) = win.window_handle() else { return None };
    let RawWindowHandle::Win32(h) = handle.as_raw() else { return None };
    Some(windows::Win32::Foundation::HWND(
        h.hwnd.get() as *mut core::ffi::c_void,
    ))
}

/// 将窗口抬升到 Z 序顶部（不抢焦点）：用于课堂窗口激活时把黑板窗口提到课堂之上
fn raise_window_no_focus(win: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    let Some(hwnd) = window_hwnd(win) else { return };
    unsafe {
        let _ = SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

/// 把 target 窗口插到 anchor 窗口之上（不抬升 anchor 的 owner 组，不抢焦点）：
/// 用于课堂弹窗（课堂子窗口）显示在黑板之上，同时课堂窗口保持原位（黑板仍在课堂之前）
fn raise_above_window(target: &tauri::WebviewWindow, anchor: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    let (Some(t), Some(a)) = (window_hwnd(target), window_hwnd(anchor)) else { return };
    unsafe {
        let _ = SetWindowPos(t, a, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}

/// 前端兜底：答案窗口等课堂弹窗创建后主动抬升到黑板之上（不抢焦点）
#[tauri::command]
fn raise_window(app: tauri::AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        raise_window_no_focus(&w);
    }
}

/// 前端兜底：把 target 窗口插到 anchor 窗口之上（不抬升 owner 组）
#[tauri::command]
fn raise_above(app: tauri::AppHandle, target: String, anchor: String) {
    if let (Some(t), Some(a)) = (
        app.get_webview_window(&target),
        app.get_webview_window(&anchor),
    ) {
        raise_above_window(&t, &a);
    }
}

/// 向黑板窗口分发事件：绕过前端 emitTo（owned 子窗口偶发收不到），由 Rust 端直接 emit_to
#[tauri::command]
fn board_emit(app: tauri::AppHandle, event: String, payload: Option<serde_json::Value>) {
    if let Some(w) = app.get_webview_window("blackboard-canvas") {
        let _ = w.emit(event.as_str(), payload);
    }
}

/// 「选择课件文件」原生对话框：owner 绑定到指定窗口（添加课件弹窗）。
/// 对话框作为 addcw 窗口的模态子窗口，只影响 addcw/课堂窗口链，黑板窗口不受任何影响。
/// 使用回调式 pick_file（非阻塞），不卡 UI 线程。
#[tauri::command]
async fn pick_courseware_dialog(
    app: tauri::AppHandle,
    parent: String,
) -> Result<Option<String>, String> {
    let win = app
        .get_webview_window(&parent)
        .ok_or_else(|| "找不到添加课件窗口".to_string())?;
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_parent(&win)
        .set_title("选择课件文件")
        .add_filter(
            "课件文件",
            &[
                "ppt",
                "pptx",
                "pdf",
                "png",
                "jpg",
                "jpeg",
                "tiff",
                "tif",
                "gif",
                "webp",
                "mp4",
                "webm",
                "mov",
                "avi",
                "mkv",
                "flv",
                "wmv",
                "m4v",
                "mp3",
                "wav",
                "m4a",
                "flac",
                "ogg",
                "aac",
                "wma",
                "html",
                "htm",
            ],
        )
        .pick_file(move |p| {
            let _ = tx.send(p.map(|p| match p {
                tauri_plugin_dialog::FilePath::Path(p) => p.to_string_lossy().into_owned(),
                tauri_plugin_dialog::FilePath::Url(u) => u.to_string(),
            }));
        });
    match rx.recv() {
        Ok(v) => Ok(v),
        Err(e) => Err(format!("选择课件文件失败：{e}")),
    }
}

/// 刷新指定窗口页面（Rust 端 eval，不重建窗口）：答案窗口复用刷新显示
#[tauri::command]
fn reload_webview(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let w = app
        .get_webview_window(&label)
        .ok_or_else(|| "窗口不存在".to_string())?;
    w.eval("location.reload()").map_err(|e| e.to_string())
}

/// 打开指定窗口的 WebView2 调试工具（开发者工具）
#[tauri::command]
fn open_devtools(app: tauri::AppHandle, label: String) {
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.open_devtools();
    }
}

/// 关闭指定窗口（答案窗口右上角关闭按钮用；Rust 端直接关闭，不依赖前端 __TAURI__ 注入）
#[tauri::command]
fn close_webview(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&label) {
        w.close().map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

/// 开始拖动指定窗口（无标题栏窗口移动；Rust 端 start_dragging）
#[tauri::command]
fn start_window_drag(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&label) {
        w.start_dragging().map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 主窗口启动兜底：上次若以最小化/隐藏状态关闭，重新打开时强制取消最小化并显示到前台
            // （避免启动后窗口不可见、任务栏只剩图标的现象）
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            // 调试：dev 构建启动后自动打开主窗口开发者工具（仅调试期；正式 release 不触发）
            if cfg!(debug_assertions) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.open_devtools();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            // 显示层级规则（自 v2 起）：课堂窗口为普通窗口；黑板窗口是课堂的子窗口（owned），
            // 由 Windows 原生保证永远显示在课堂窗口上方；课堂弹窗（答案/添加课件/清空确认）
            // 是黑板窗口的子窗口，永远显示在黑板窗口上方（不被黑板遮挡）。
            // 不再需要任何手动 Z 序/置顶/守护代码。
            //
            // 课堂窗口销毁 → 同步关闭黑板、答案窗口、添加课件弹窗与清空确认弹窗
            // （owned 子窗口会随父窗口自动关闭，此处为双保险，不阻塞课堂窗口关闭流程）
            if let tauri::WindowEvent::Destroyed = event {
                if label.starts_with("classroom-") {
                    let app = window.app_handle();
                    if let Some(bw) = app.get_webview_window("blackboard-canvas") {
                        let _ = bw.close();
                    }
                    let labels: Vec<String> = app
                        .webview_windows()
                        .values()
                        .filter(|w| {
                            w.label().starts_with("answer-")
                                || w.label().starts_with("addcw-")
                                || w.label().starts_with("confirm-")
                        })
                        .map(|w| w.label().to_string())
                        .collect();
                    for l in labels {
                        if let Some(w) = app.get_webview_window(&l) {
                            let _ = w.close();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            detect_ppt_converters,
            convert_ppt_to_pdf,
            scan_courseware_tree,
            remove_import_cache,
            read_courseware_file,
            import_courseware_dir,
            tiff_first_frame_text,
            raise_window,
            raise_above,
            pick_courseware_dialog,
            reload_webview,
            open_devtools,
            close_webview,
            start_window_drag,
            board_emit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
