"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function ComparisonBarChart({
  data,
  color = "#356f53",
  horizontal = false,
  ariaLabel,
}: {
  data: Array<{ name: string; rate: number; count?: number }>;
  color?: string;
  horizontal?: boolean;
  ariaLabel: string;
}) {
  return (
    <div
      className={horizontal ? "chart-box tall" : "chart-box"}
      role="img"
      aria-label={ariaLabel}
    >
      <BarChart
        accessibilityLayer={false}
        role="presentation"
        tabIndex={-1}
        responsive
        style={{ width: "100%", height: "100%" }}
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={
          horizontal
            ? { top: 4, right: 12, left: 28, bottom: 0 }
            : { top: 10, right: 8, left: -18, bottom: 0 }
        }
      >
        <CartesianGrid
          stroke="#e4eae4"
          strokeDasharray="3 4"
          horizontal={!horizontal}
          vertical={horizontal}
        />
        {horizontal ? (
          <>
            <XAxis
              type="number"
              domain={[0, 50]}
              unit="%"
              tick={{ fontSize: 10 }}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={72}
              tick={{ fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, 50]}
              unit="%"
              tick={{ fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
          </>
        )}
        <Tooltip
          formatter={(value) => [`${value}%`, "加權剩食率"]}
          contentStyle={{
            borderRadius: 6,
            borderColor: "#dfe8df",
            fontSize: 12,
          }}
        />
        <Bar
          dataKey="rate"
          fill={color}
          radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
        >
          {data.map((_, index) => (
            <Cell key={index} fill={index % 2 ? color : "#6e967e"} />
          ))}
        </Bar>
      </BarChart>
    </div>
  );
}
