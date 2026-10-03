param(
  [string]$FixtureDirectory,
  [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
$fixtureRoot = (Resolve-Path -LiteralPath $FixtureDirectory).Path
$expected = @{
  'spring-dst' = @(7500, 0.96, 3600, 7680, 7740, 7920)
  'fall-dst' = @(7500, 0.96, 3600, 7680, 7740, 7920)
  'shanghai' = @(7500, 0.96, 3600, 7680, 7740, 7920)
  'elapsed' = @(7500, 0.96, 3600, 7680, 7740, 7920)
  'late-first-arrival' = @(7500, 0.96, 3600, 7680, 7740, 7680)
  'excel-1900' = @(3600, 1, 3600, 3720, 3780, 3720)
  'before-1900' = @(3600, 1, 3600, 3720, 3780, 3720)
  'fractional' = @(92.125, 0.9810040705563093, 30.125, 109.875, 111.125, 125.125)
  'rotation' = @(30, 1, 10, 210, 270, 210)
  'batch-tail' = @(22, 0.6818181818181818, 10, 202, 262, 442)
}
$fields = @(
  @('排程总览', 'F17', 86400), @('排程总览', 'G17', 1),
  @('人员排程', 'J6', 86400), @('排程总览', 'B6', 86400),
  @('排程总览', 'B7', 86400), @('排程总览', 'D12', 86400)
)
$excel = $null
$items = [System.Collections.Generic.List[object]]::new()
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $version = $excel.Version
  foreach ($name in ($expected.Keys | Sort-Object)) {
    $book = $null
    try {
      $book = $excel.Workbooks.Open((Join-Path $fixtureRoot ($name + '.xlsx')), 0, $true)
      $excel.CalculateFullRebuild()
      $values = [System.Collections.Generic.List[object]]::new()
      for ($index=0; $index -lt $fields.Count; $index++) {
        $sheet = $book.Worksheets.Item($fields[$index][0])
        $cell = $sheet.Range($fields[$index][1])
        try {
          $actual = [double]$cell.Value2 * [double]$fields[$index][2]
          $target = [double]$expected[$name][$index]
          if ([Math]::Abs($actual-$target) -gt 0.000001) { throw "$name $($fields[$index][1]): expected $target, actual $actual" }
          $values.Add(@{sheet=$fields[$index][0]; cell=$fields[$index][1]; value=$actual; expected=$target; formula=$cell.Formula})
        } finally {
          [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($cell)
          [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)
        }
      }
      if ($book.Worksheets.Count -ne 4) { throw "$name sheet count" }
      $items.Add(@{name=$name; passed=$true; checks=$values.ToArray()})
      Write-Output "PASS native Excel full recalculation: $name"
    } finally {
      if ($null -ne $book) { $book.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) }
    }
  }
  $report = @{passed=$true; excelVersion=$version; workbookCount=$items.Count; cellChecks=$items.Count*$fields.Count; workbooks=$items.ToArray(); timestamp=(Get-Date).ToUniversalTime().ToString('o')}
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding utf8
} finally {
  if ($null -ne $excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
