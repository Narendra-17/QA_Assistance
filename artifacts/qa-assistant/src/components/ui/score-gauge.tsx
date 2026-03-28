import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

interface ScoreGaugeProps {
  score: number;
  className?: string;
  size?: number;
}

export function ScoreGauge({ score, className, size = 120 }: ScoreGaugeProps) {
  const data = [
    { name: "Score", value: score },
    { name: "Remaining", value: 100 - score },
  ];

  let color = "hsl(var(--destructive))";
  if (score >= 80) color = "hsl(var(--chart-3))"; // Green
  else if (score >= 60) color = "hsl(var(--chart-4))"; // Yellow
  else if (score >= 40) color = "hsl(var(--chart-2))"; // Orange/Purple ish depending on theme

  return (
    <div 
      className={cn("relative flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
        <span className="text-3xl font-display font-bold tabular-nums tracking-tighter" style={{ color }}>
          {score}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          Score
        </span>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="75%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            dataKey="value"
            stroke="none"
            isAnimationActive={true}
          >
            <Cell fill={color} style={{ filter: `drop-shadow(0 0 6px ${color}40)` }} />
            <Cell fill="hsl(var(--muted))" opacity={0.3} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
