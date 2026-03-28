import { useListQaRuns, useDeleteQaRun, getListQaRunsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Plus, Trash2, ExternalLink, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function Dashboard() {
  const { data, isLoading } = useListQaRuns({
    query: {
      refetchInterval: (query) => {
        // Poll if any runs are pending or running
        const runs = query.state.data?.runs || [];
        const needsPolling = runs.some(r => r.status === 'pending' || r.status === 'running');
        return needsPolling ? 3000 : false;
      }
    }
  });
  
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteQaRun({
    mutation: {
      onSuccess: () => {
        toast.success("Test run deleted");
        queryClient.invalidateQueries({ queryKey: getListQaRunsQueryKey() });
      },
      onError: () => toast.error("Failed to delete test run")
    }
  });

  const runs = data?.runs || [];

  return (
    <div className="max-w-7xl mx-auto w-full space-y-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage your automated QA test runs.</p>
        </div>
        <Button asChild className="rounded-full shadow-lg shadow-primary/20">
          <Link href="/new">
            <Plus className="w-4 h-4 mr-2" />
            New Test Run
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="h-48 animate-pulse bg-muted/20 border-border/50" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center justify-center py-32 px-4 text-center border-2 border-dashed border-border/50 rounded-3xl bg-card/20 backdrop-blur-sm"
        >
          <div className="bg-primary/10 p-4 rounded-full mb-6">
            <Activity className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl font-display font-semibold mb-2">No tests run yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            Create your first automated QA test to validate your application's functionality.
          </p>
          <Button asChild size="lg" className="rounded-full">
            <Link href="/new">Create First Test</Link>
          </Button>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {runs.map((run, i) => (
            <motion.div
              key={run.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="glass-panel overflow-hidden group hover:border-primary/30 transition-colors h-full flex flex-col">
                <div className="p-6 flex-1 flex flex-col">
                  <div className="flex items-start justify-between mb-4 gap-4">
                    <StatusBadge status={run.status} />
                    
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mr-2 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="glass-panel sm:max-w-md">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Test Run?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the test run and its associated report.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={() => deleteMutation.mutate({ data: undefined as any, id: run.id })}
                            className="bg-destructive hover:bg-destructive/90 rounded-full"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  
                  <div className="space-y-1 mb-6 flex-1">
                    <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">
                      {new URL(run.appUrl).hostname}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {run.appDescription}
                    </p>
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-border/50">
                    <span>{format(new Date(run.createdAt), 'MMM d, yyyy • h:mm a')}</span>
                    <Button asChild variant="link" className="h-auto p-0 text-primary hover:text-primary/80 font-medium">
                      <Link href={`/runs/${run.id}`}>
                        View Details
                        <ExternalLink className="ml-1.5 w-3 h-3" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
