import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp } from "lucide-react";

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;

    function onScroll() {
      setVisible(main!.scrollTop > 300);
    }

    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, []);

  function scrollToTop() {
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.75 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.75 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          onClick={scrollToTop}
          aria-label="Back to top"
          title="Back to top (↑)"
          className="fixed bottom-6 right-6 z-40 w-10 h-10 rounded-full flex items-center justify-center text-white shadow-xl shadow-black/40 border border-violet-500/30 hover:scale-110 active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg,#7c3aed,#6d28d9)", backdropFilter: "blur(12px)" }}
        >
          <ChevronUp className="w-5 h-5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
