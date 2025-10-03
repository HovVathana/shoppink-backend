const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debugHierarchy() {
  try {
    console.log('🔍 Debugging Option Group Hierarchy...\n');
    
    // Get all option groups for your product
    const groups = await prisma.productOptionGroup.findMany({
      include: {
        options: true,
        parentGroup: true,
        childGroups: true,
      },
      orderBy: { level: 'asc' }
    });
    
    console.log('📊 Current Option Groups:');
    groups.forEach(group => {
      console.log(`
ID: ${group.id}
Name: ${group.name}
Level: ${group.level}
Parent ID: ${group.parentGroupId || 'NULL (root)'}
Parent Name: ${group.parentGroup?.name || 'None'}
Options: ${group.options.length}
Child Groups: ${group.childGroups.length}
---`);
    });
    
    // Check for issues
    console.log('\n🚨 Potential Issues:');
    
    const level1Groups = groups.filter(g => g.level === 1);
    const level2Groups = groups.filter(g => g.level === 2);
    const level3Groups = groups.filter(g => g.level === 3);
    
    console.log(`Level 1 groups: ${level1Groups.length}`);
    console.log(`Level 2 groups: ${level2Groups.length}`);
    console.log(`Level 3 groups: ${level3Groups.length}`);
    
    // Check if Material group exists and has correct parent
    const materialGroup = groups.find(g => g.name.toLowerCase().includes('material'));
    if (materialGroup) {
      console.log(`\n📦 Material Group Found:`);
      console.log(`- ID: ${materialGroup.id}`);
      console.log(`- Level: ${materialGroup.level}`);
      console.log(`- Parent ID: ${materialGroup.parentGroupId}`);
      console.log(`- Options: ${materialGroup.options.length}`);
      
      if (materialGroup.level !== 3) {
        console.log(`❌ Material should be level 3, but is level ${materialGroup.level}`);
      }
      
      if (!materialGroup.parentGroupId) {
        console.log(`❌ Material has no parent - it should be under Color group`);
      }
    } else {
      console.log(`❌ No Material group found`);
    }
    
    // Check Color group
    const colorGroup = groups.find(g => g.name.toLowerCase().includes('color'));
    if (colorGroup) {
      console.log(`\n🎨 Color Group Found:`);
      console.log(`- ID: ${colorGroup.id}`);
      console.log(`- Level: ${colorGroup.level}`);
      console.log(`- Parent ID: ${colorGroup.parentGroupId}`);
      console.log(`- Child Groups: ${colorGroup.childGroups.length}`);
      
      if (materialGroup && materialGroup.parentGroupId !== colorGroup.id) {
        console.log(`❌ Material's parent should be Color group (${colorGroup.id}), but is ${materialGroup.parentGroupId}`);
      }
    }
    
    console.log('\n🔧 Suggested Fixes:');
    
    if (materialGroup && colorGroup) {
      if (materialGroup.level !== 3 || materialGroup.parentGroupId !== colorGroup.id) {
        console.log(`
To fix Material group hierarchy, run:
UPDATE "product_option_groups" 
SET "level" = 3, "parentGroupId" = '${colorGroup.id}' 
WHERE "id" = '${materialGroup.id}';
        `);
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugHierarchy();
