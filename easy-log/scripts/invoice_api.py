#!/usr/bin/env python3
"""工作管理系统发票文件 API 客户端。

调用顺序：上传文件 -> 解析发票 ->（创建发票后）添加附件。
认证默认从 WORK_MANAGEMENT_API_KEY 读取，避免把令牌写入脚本。
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib import error, request


def multipart_body(file_path: Path) -> tuple[bytes, str]:
    if not file_path.is_file():
        raise FileNotFoundError(f"文件不存在: {file_path}")
    boundary = f"----WorkManagementInvoice{uuid.uuid4().hex}"
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    payload = file_path.read_bytes()
    header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8")
    body = header + payload + f"\r\n--{boundary}--\r\n".encode("ascii")
    return body, f"multipart/form-data; boundary={boundary}"


def post_file(base_url: str, api_key: str, path: str, file_path: Path, timeout: float) -> dict[str, Any]:
    body, content_type = multipart_body(file_path)
    req = request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": content_type,
            "Content-Length": str(len(body)),
        },
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {req.full_url} 失败: HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"POST {req.full_url} 连接失败: {exc.reason}") from exc
    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"POST {req.full_url} 返回非 JSON: {raw[:500]!r}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"POST {req.full_url} 返回格式不是对象: {data!r}")
    return data


def upload(base_url: str, api_key: str, file_path: Path, timeout: float) -> dict[str, Any]:
    """上传发票文件并返回服务端生成的文件信息。"""
    return post_file(base_url, api_key, "/save/invoices", file_path, timeout)


def parse_invoice(base_url: str, api_key: str, file_path: Path, timeout: float) -> dict[str, Any]:
    return post_file(base_url, api_key, "/parse-invoice", file_path, timeout)


def add_attachment(base_url: str, api_key: str, invoice_id: int, file_path: Path, timeout: float) -> dict[str, Any]:
    return post_file(base_url, api_key, f"/invoice/add_attachment/{invoice_id}", file_path, timeout)


def main() -> int:
    parser = argparse.ArgumentParser(description="上传/解析发票文件，或为已有发票添加附件")
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.getenv("WORK_MANAGEMENT_TIMEOUT", "60")),
        help="请求超时时间（秒），默认读取 WORK_MANAGEMENT_TIMEOUT 或 60",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    upload_parser = sub.add_parser("upload", help="上传发票文件并获取 attachment id")
    upload_parser.add_argument("file", type=Path)

    parse_parser = sub.add_parser("parse", help="解析发票文件")
    parse_parser.add_argument("file", type=Path)

    attach_parser = sub.add_parser("add-attachment", help="为已有发票添加附件")
    attach_parser.add_argument("invoice_id", type=int)
    attach_parser.add_argument("file", type=Path)

    args = parser.parse_args()
    # CLI 固定使用线上服务地址。
    base_url = "https://ai-log.hycx-gd.cn/Log/api"
    api_key = os.getenv("WORK_MANAGEMENT_API_KEY")
    if not api_key:
        parser.error("请设置环境变量 WORK_MANAGEMENT_API_KEY")
    try:
        if args.command == "upload":
            result = upload(base_url, api_key, args.file, args.timeout)
        elif args.command == "parse":
            result = parse_invoice(base_url, api_key, args.file, args.timeout)
        else:
            result = add_attachment(base_url, api_key, args.invoice_id, args.file, args.timeout)
    except (OSError, RuntimeError) as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
