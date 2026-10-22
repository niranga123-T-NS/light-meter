import { AcademyCard } from '@/components/home/AcademyCard';
import { AdminHome, OpsHome } from '@/components/home/OtherHomes';
import { ExecDashboard } from '@/components/home/ExecDashboard';
import { EngineerHome } from '@/components/home/EngineerHome';
import { FxCard } from '@/components/FxRates';
import { DesignBoard, EstimationBoard } from '@/components/home/JobBoards';
import { SalesHome } from '@/components/home/SalesHome';
import { MyDayMeetings } from '@/components/WeekMeetings';
import { GuestHome } from '@/components/home/GuestHome';
import { useMe } from '@/lib/auth';

/** Each role opens to its own dashboard (Section 9). */
export default function Home() {
  const me = useMe();
  switch (me.role) {
    case 'asm_building':
    case 'asm_infra':
      return <SalesHome />;
    case 'design_manager':
    case 'lighting_designer':
    case 'lighting_engineer':
      return (
        <DesignBoard
          header={
            <>
              <MyDayMeetings />
              <AcademyCard />
            </>
          }
        />
      );
    case 'sm_estimation':
    case 'am_estimation':
    case 'estimation_exec':
      return (
        <EstimationBoard
          header={
            <>
              <MyDayMeetings />
              <FxCard />
              <AcademyCard />
            </>
          }
        />
      );
    case 'gm':
    case 'sm_projects':
      return <ExecDashboard />;
    case 'operations_exec':
      return <OpsHome />;
    case 'senior_elec_engineer':
    case 'assistant_engineer':
    case 'trainee':
    case 'sub_supervisor':
      return <EngineerHome />;
    case 'guest':
      return <GuestHome />;
    default:
      return <AdminHome />;
  }
}
