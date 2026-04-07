import { IDELayout } from "@/components/ide/IDELayout";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { ProblemsProvider } from "@/contexts/ProblemsContext";
import { ExtensionProvider } from "@/contexts/ExtensionContext";

function App() {
  return (
    <NotificationProvider>
      <ProblemsProvider>
        <ExtensionProvider>
          <ProjectProvider>
            <IDELayout />
          </ProjectProvider>
        </ExtensionProvider>
      </ProblemsProvider>
    </NotificationProvider>
  );
}

export default App;
