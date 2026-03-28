import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ArrowRight, Zap, Bot, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";

export default function Landing() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen w-full bg-background relative overflow-hidden flex flex-col">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img 
          src={`${import.meta.env.BASE_URL}images/hero-bg.png`} 
          alt="Abstract tech background" 
          className="w-full h-full object-cover opacity-40 mix-blend-screen"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
      </div>

      {/* Navbar */}
      <nav className="relative z-10 w-full px-6 py-6 max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-primary/20 p-2 rounded-xl backdrop-blur-md border border-primary/30">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <span className="font-display font-bold text-xl tracking-tight text-white">
            QA Assistant
          </span>
        </div>
        <Button variant="ghost" onClick={login} className="text-muted-foreground hover:text-white rounded-full px-6">
          Sign In
        </Button>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="space-y-8 flex flex-col items-center"
        >
          <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary backdrop-blur-md">
            <SparklesIcon className="w-4 h-4 mr-2" />
            AI-Powered Testing Platform
          </div>
          
          <h1 className="font-display text-5xl md:text-7xl font-bold tracking-tight text-white leading-[1.1]">
            Vibe Code Faster.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">
              Test Automatically.
            </span>
          </h1>
          
          <p className="max-w-2xl text-lg md:text-xl text-muted-foreground">
            Stop wasting time on manual QA. Connect your app, describe the expected behavior, and let our AI QA Assistant find the bugs before your users do.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <Button 
              size="lg" 
              onClick={login}
              className="h-14 px-8 rounded-full text-base font-semibold bg-gradient-to-r from-primary to-primary/80 hover:to-primary hover:shadow-lg hover:shadow-primary/25 transition-all"
            >
              Get Started Free
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </div>
        </motion.div>

        {/* Feature Grid */}
        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-24 w-full"
        >
          {[
            {
              icon: Bot,
              title: "AI Test Generation",
              desc: "Provide plain English descriptions and AI generates the exact interaction steps to test your app."
            },
            {
              icon: Zap,
              title: "Instant Execution",
              desc: "Tests run headlessly in the cloud using Playwright for incredibly fast validation."
            },
            {
              icon: BarChart3,
              title: "Actionable Reports",
              desc: "Get rich visual reports with severity scores, bug locations, and suggested code fixes."
            }
          ].map((feature, i) => (
            <div key={i} className="glass-panel rounded-2xl p-8 text-left relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="bg-muted/50 w-12 h-12 rounded-xl flex items-center justify-center mb-6 border border-white/5">
                <feature.icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">{feature.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </motion.div>
      </main>
    </div>
  );
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round" {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
      <path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
    </svg>
  );
}
