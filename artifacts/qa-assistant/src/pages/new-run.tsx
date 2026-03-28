import { useCreateQaRun } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { BrainCircuit, Link as LinkIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { motion } from "framer-motion";

const formSchema = z.object({
  appUrl: z.string().url("Please enter a valid URL (e.g., https://example.com)"),
  appDescription: z.string().min(10, "Please provide a more detailed description (min 10 chars)"),
});

export default function NewRun() {
  const [, setLocation] = useLocation();
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      appUrl: "",
      appDescription: "",
    },
  });

  const createMutation = useCreateQaRun({
    mutation: {
      onSuccess: (data) => {
        toast.success("Test run created successfully!");
        setLocation(`/runs/${data.id}`);
      },
      onError: (err) => {
        toast.error(err.error?.error || "Failed to create test run");
      }
    }
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    createMutation.mutate({ data: values });
  }

  return (
    <div className="max-w-3xl mx-auto w-full space-y-8">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">New Test Run</h1>
        <p className="text-muted-foreground mt-1 text-sm">Configure a new automated QA assessment for your application.</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card className="glass-panel overflow-hidden border-primary/20">
          <div className="h-2 bg-gradient-to-r from-primary via-accent to-primary" />
          <div className="p-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                
                <FormField
                  control={form.control}
                  name="appUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Application URL</FormLabel>
                      <FormDescription>
                        The accessible URL of the application to test (local or remote).
                      </FormDescription>
                      <FormControl>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none text-muted-foreground">
                            <LinkIcon className="w-4 h-4" />
                          </div>
                          <Input 
                            placeholder="https://your-app.com" 
                            className="pl-11 h-12 bg-background/50 border-border/50 focus-visible:ring-primary/50 text-base rounded-xl"
                            {...field} 
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="appDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base flex items-center gap-2">
                        Expected Behavior
                        <Sparkles className="w-4 h-4 text-primary" />
                      </FormLabel>
                      <FormDescription>
                        Describe how the application should work. The AI will use this to generate test cases.
                      </FormDescription>
                      <FormControl>
                        <Textarea 
                          placeholder="This is a task management app. Users should be able to create new tasks, mark them as complete, and delete them. The home page should load within 2 seconds..." 
                          className="min-h-[160px] bg-background/50 border-border/50 focus-visible:ring-primary/50 text-base resize-y rounded-xl p-4 leading-relaxed"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="pt-4 border-t border-border/50 flex justify-end">
                  <Button 
                    type="submit" 
                    size="lg" 
                    disabled={createMutation.isPending}
                    className="h-12 px-8 rounded-full shadow-lg shadow-primary/20 bg-gradient-to-r from-primary to-primary/80 hover:to-primary"
                  >
                    {createMutation.isPending ? (
                      <>
                        <BrainCircuit className="w-5 h-5 mr-2 animate-pulse" />
                        Initializing AI...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5 mr-2" />
                        Start Assessment
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
