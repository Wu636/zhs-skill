import base64, json, os, time, tempfile
from pathlib import Path

_CFG = Path.home() / ".hermes/skills/polymas/training-config-generate-inject/config/config.json"
_REQUIRED_ANY = ("zhs-jt-cas", "ai-poly")


def _jwt_exp(token):
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        exp = json.loads(base64.urlsafe_b64decode(part)).get("exp")
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(exp)) if exp else ""
    except Exception:
        return ""


def refresh_polymas_cookie():
    if _CFG.is_symlink() or _CFG.resolve().is_relative_to(Path.home() / ".agents/skills"):
        raise ValueError("凭据配置必须是 Hermes 本地普通文件，不能指向共享技能树")
    cfg = json.loads(_CFG.read_text())
    pol = cfg.setdefault("polymas", {})
    urls = [pol.get("uiBaseUrl") or "https://hike-teaching-center.polymas.com",
            pol.get("apiBaseUrl") or "https://cloudapi.polymas.com"]
    # Network.getCookies 按 URL 返回浏览器会实际发送的 Cookie，含 httpOnly（document.cookie 拿不到）
    cookies = cdp("Network.getCookies", urls=urls)["cookies"]
    jar = {}
    for c in cookies:
        if c["name"] in _REQUIRED_ANY:
            jar.setdefault(c["name"], c["value"])
    names = list(jar)
    if not any(k in jar for k in _REQUIRED_ANY):
        print("未登录：内置浏览器里没有 zhs-jt-cas / ai-poly，未修改配置。拿到的 cookie:", names)
        return False
    pol["cookie"] = "; ".join(f"{k}={v}" for k, v in jar.items())
    fd, temp_name = tempfile.mkstemp(prefix=".cookie-", suffix=".tmp", dir=_CFG.parent)
    tmp = Path(temp_name)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(cfg, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        tmp.replace(_CFG)
    finally:
        tmp.unlink(missing_ok=True)
    exp = {k: _jwt_exp(jar[k]) for k in _REQUIRED_ANY if k in jar}
    print("已写入", _CFG, "| cookie 项:", names, "| JWT 到期:", exp)
    return True


refresh_polymas_cookie()
