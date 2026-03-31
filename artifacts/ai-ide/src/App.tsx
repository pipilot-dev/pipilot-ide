import { TooltipProvider } from "@/components/ui/tooltip";
import { IDELayout } from "@/components/ide/IDELayout";

function App() {
  return (
    <TooltipProvider delayDuration={400}>
      <IDELayout />
    </TooltipProvider>
  );
}

export default App;
