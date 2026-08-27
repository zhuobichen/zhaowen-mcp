# 文件管理辅助脚本占位
# 实际脚本根据需要添加

function Get-FileSummary {
    param(
        [string]$Path = "."
    )

    $items = Get-ChildItem -Path $Path -File -Recurse -ErrorAction SilentlyContinue
    $totalSize = ($items | Measure-Object -Property Length -Sum).Sum

    return [PSCustomObject]@{
        FileCount = $items.Count
        TotalSize = $totalSize
        Path = (Resolve-Path $Path).Path
    }
}

# 示例使用
# Get-FileSummary -Path "." | Format-List