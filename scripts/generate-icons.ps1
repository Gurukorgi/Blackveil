$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Add-Type -AssemblyName System.Drawing

function Make-Icon {
  param([int]$Size, [string]$Path)
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(10, 10, 15))
  $rect = New-Object System.Drawing.RectangleF 0, 0, $Size, $Size
  $c1 = [System.Drawing.Color]::FromArgb(55, 48, 82)
  $c2 = [System.Drawing.Color]::FromArgb(10, 10, 15)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 42.0
  $pad = [Math]::Max(1, [int]($Size * 0.08))
  $g.FillEllipse($brush, $pad, $pad, $Size - 2 * $pad, $Size - 2 * $pad)
  $penWidth = [Math]::Max(1.0, $Size / 24.0)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(139, 124, 247)), $penWidth
  $inset = $Size * 0.26
  $g.DrawEllipse($pen, $inset, $inset, $Size - 2 * $inset, $Size - 2 * $inset)
  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

Make-Icon -Size 16 -Path (Join-Path $dir 'icon16.png')
Make-Icon -Size 32 -Path (Join-Path $dir 'icon32.png')
Make-Icon -Size 48 -Path (Join-Path $dir 'icon48.png')
Make-Icon -Size 128 -Path (Join-Path $dir 'icon128.png')
Write-Host "Icons written to $dir"
