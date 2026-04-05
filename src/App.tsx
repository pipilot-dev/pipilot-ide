import { IDELayout } from "@/components/ide/IDELayout";
import { ProjectProvider } from "@/contexts/ProjectContext";

function App() {
  return (
    <ProjectProvider>
      <IDELayout />
    </ProjectProvider>
  );
}

export default App;
