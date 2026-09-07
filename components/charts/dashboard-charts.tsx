"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function TrendChart({
  data,
}: {
  data: Array<{ label: string; rate: number; samples: number }>;
}) {
  return (
    <div className="chart-box" role="img" aria-label="每日剩食率趨勢折線圖">
      <AreaChart
        accessibilityLayer={false}
        role="presentation"
        tabIndex={-1}
        responsive
        style={{ width: "100%", height: "100%" }}
        data={data}
        margin={{ top: 12, right: 8, left: -20, bottom: 0 }}
      >
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#397659" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#397659" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={false}
          stroke="#e3ebe4"
          strokeDasharray="3 4"
        />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#769086" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 50]}
          tick={{ fontSize: 10, fill: "#769086" }}
          axisLine={false}
          tickLine={false}
          unit="%"
        />
        <Tooltip
          formatter={(value) => [`${value}%`, "加權剩食率"]}
          contentStyle={{
            borderRadius: 12,
            borderColor: "#dfe8df",
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="rate"
          stroke="#286346"
          strokeWidth={3}
          fill="url(#trendFill)"
          activeDot={{ r: 5, fill: "#d99a3e" }}
        />
      </AreaChart>
    </div>
  );
}
