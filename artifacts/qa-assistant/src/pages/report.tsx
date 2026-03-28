import { useGetQaRun } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { format } from "date-fns";
import { 
  ArrowLeft, 
  AlertCircle, 
  AlertTriangle, 
  Info, 
  TerminalSquare,
  CheckCircle2,
  Lightbulb
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { ScoreGauge } from "@/components/ui/score-gauge";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import type { QaIssueSeverity } from "@workspace/api-client-react/src/generated/api.schemas";

function SeverityIcon({ severity }: { severity: QaIssueSeverity }) {
  switch (severity) {
    case 'critical': return <AlertCircle className="w-5 h-5 text-red-500" />;
    case 'high': return <AlertTriangle className="w-5 h-5 text-orange-500" />;
    case 'medium': return <Info className="w-5 h-5 text-yellow-500" />;
    case 'low': return <TerminalSquare className="w-5 h-5 text-blue-500" />;
  }
}

function SeverityBadge({ severity }: { severity: QaIssueSeverity }) {
  const styles = {
    critical: "bg-red-500/10 text-red-500 border-red-500/20",
    high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    low: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  };

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border ${styles[severity]}`}>
      {severity}
    </span>
  );
}

export default function Report() {
  const params = useParams();
  const { data: run, isLoading, error } = useGetQaRun(params.id!, {
    query: {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'pending' || status === 'running' ? 3000 : false;
      }
    }
  });

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <AlertCircle className="w-12 h-12 text-destructive mb-4" />
        <h2 className="text-xl font-bold">Failed to load report</h2>
        <p className="text-muted-foreground mt-2 mb-6">The report might have been deleted or doesn't exist.</p>
        <Button asChild variant="outline"><Link href="/">Back to Dashboard</Link></Button>
      </div>
    );
  }

  if (isLoading || !run) {
    return (
      <div className="max-w-5xl mx-auto space-y-8">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-64 rounded-2xl col-span-1" />
          <Skeleton className="h-64 rounded-2xl col-span-2" />
        </div>
      </div>
    );
  }

  const report = run.report;
  const isProcessing = run.status === 'pending' || run.status === 'running';

  return (
    <div className="max-w-5xl mx-auto w-full space-y-8 pb-16">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon" className="rounded-full shrink-0">
          <Link href="/">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-display font-bold text-foreground truncate">
              {new URL(run.appUrl).hostname}
            </h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Started on {format(new Date(run.createdAt), 'MMMM d, yyyy at h:mm a')}
          </p>
        </div>
      </div>

      {isProcessing && (
        <Card className="glass-panel p-12 flex flex-col items-center justify-center text-center border-primary/20">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
            <div className="bg-card border border-primary/30 p-4 rounded-full relative z-10 mb-6 shadow-xl shadow-primary/10">
              <TerminalSquare className="w-8 h-8 text-primary animate-pulse" />
            </div>
          </div>
          <h2 className="text-2xl font-display font-bold mb-2">AI is Analyzing Your App</h2>
          <p className="text-muted-foreground max-w-md">
            The QA Assistant is currently executing tests against your application and compiling the results. This typically takes 30-60 seconds.
          </p>
        </Card>
      )}

      {run.status === 'failed' && (
        <Card className="bg-destructive/10 border-destructive/30 p-8 text-center rounded-2xl">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold text-destructive mb-2">Assessment Failed</h2>
          <p className="text-destructive/80 max-w-lg mx-auto">
            {run.errorMessage || "An unexpected error occurred while testing the application. Please ensure the URL is publicly accessible."}
          </p>
        </Card>
      )}

      {run.status === 'completed' && report && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          
          {/* Top Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="glass-panel p-6 flex flex-col items-center justify-center text-center h-full">
              <ScoreGauge score={report.overallScore} size={140} className="mb-4" />
              <h3 className="font-semibold text-lg">Overall Health</h3>
            </Card>
            
            <Card className="glass-panel p-6 col-span-1 md:col-span-2 flex flex-col justify-center">
              <h3 className="text-sm uppercase tracking-wider text-muted-foreground font-semibold mb-3 flex items-center">
                <CheckCircle2 className="w-4 h-4 mr-2 text-primary" />
                Executive Summary
              </h3>
              <p className="text-foreground/90 leading-relaxed text-lg">
                {report.summary}
              </p>
            </Card>
          </div>

          {/* Recommendations */}
          {report.recommendations && report.recommendations.length > 0 && (
            <Card className="glass-panel overflow-hidden border-accent/20">
              <div className="bg-accent/10 px-6 py-4 border-b border-accent/20 flex items-center">
                <Lightbulb className="w-5 h-5 text-accent mr-3" />
                <h3 className="font-semibold text-accent">Key Recommendations</h3>
              </div>
              <div className="p-6">
                <ul className="space-y-3">
                  {report.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start">
                      <div className="w-1.5 h-1.5 rounded-full bg-accent/50 mt-2 mr-3 shrink-0" />
                      <span className="text-muted-foreground">{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}

          {/* Issues List */}
          <div>
            <h2 className="text-xl font-display font-bold mb-4 flex items-center">
              Identified Issues
              <span className="ml-3 bg-muted px-2.5 py-0.5 rounded-full text-xs font-medium text-muted-foreground">
                {report.issues.length}
              </span>
            </h2>
            
            <div className="space-y-4">
              {report.issues.length === 0 ? (
                <Card className="p-12 text-center border-dashed border-2 bg-transparent">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold">Perfect Score!</h3>
                  <p className="text-muted-foreground mt-2">No issues were detected during the assessment.</p>
                </Card>
              ) : (
                report.issues.map((issue, i) => (
                  <Card key={i} className="glass-panel overflow-hidden relative group">
                    {/* Severity colored left border */}
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                      issue.severity === 'critical' ? 'bg-red-500' :
                      issue.severity === 'high' ? 'bg-orange-500' :
                      issue.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                    }`} />
                    
                    <div className="p-6 pl-8">
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex items-center gap-3">
                          <SeverityIcon severity={issue.severity} />
                          <h3 className="font-bold text-lg">{issue.title}</h3>
                        </div>
                        <SeverityBadge severity={issue.severity} />
                      </div>
                      
                      <div className="space-y-4">
                        <p className="text-muted-foreground leading-relaxed">
                          {issue.description}
                        </p>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border/50">
                          <div className="bg-background/50 rounded-xl p-4 border border-border/50">
                            <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Possible Cause</h4>
                            <p className="text-sm">{issue.possibleCause}</p>
                          </div>
                          <div className="bg-primary/5 rounded-xl p-4 border border-primary/10">
                            <h4 className="text-xs uppercase tracking-wider font-semibold text-primary mb-2">Suggested Fix</h4>
                            <p className="text-sm text-primary/90">{issue.suggestedFix}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </div>

        </motion.div>
      )}
    </div>
  );
}
