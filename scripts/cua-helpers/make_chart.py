#!/usr/bin/env python3
"""Create an Excel bar chart from command-line arguments.

Usage:
    python make_chart.py output.xlsx "Title" "Label1:Value1" "Label2:Value2" ...

Example:
    python make_chart.py C:/Users/me/Desktop/chart.xlsx "BLEU Scores" "base:25.8" "(A):24.9" "(B):25.1"
"""
import sys, os

def main():
    if len(sys.argv) < 4:
        print("Usage: python make_chart.py <output.xlsx> <title> <label:value> [label:value ...]")
        sys.exit(1)

    out_path = sys.argv[1]
    title = sys.argv[2]
    pairs = sys.argv[3:]

    import openpyxl
    from openpyxl.chart import BarChart, Reference

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Data"

    # Header
    ws.append(["Model", title])

    # Data rows
    for pair in pairs:
        if ":" in pair:
            label, val = pair.rsplit(":", 1)
            try:
                ws.append([label.strip(), float(val.strip())])
            except ValueError:
                ws.append([label.strip(), val.strip()])
        else:
            ws.append([pair, 0])

    # Chart
    chart = BarChart()
    chart.type = "col"
    chart.style = 10
    chart.title = title
    chart.y_axis.title = title
    chart.x_axis.title = "Configuration"

    data = Reference(ws, min_col=2, min_row=1, max_row=len(pairs) + 1)
    cats = Reference(ws, min_col=1, min_row=2, max_row=len(pairs) + 1)
    chart.add_data(data, titles_from_data=True)
    chart.set_categories(cats)
    chart.width = 18
    chart.height = 12

    ws.add_chart(chart, "D2")
    wb.save(out_path)
    print(f"Chart saved: {out_path}")

if __name__ == "__main__":
    main()
